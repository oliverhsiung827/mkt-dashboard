import { auth, db } from "./firebase.js";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  collection,
  addDoc,
  onSnapshot,
  updateDoc,
  doc,
  deleteDoc,
  query,
  where,
  getDocs,
  limit,
  orderBy,
  getDoc,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { createApp } from "https://unpkg.com/vue@3/dist/vue.esm-browser.js";

// --- Factory Helpers ---
const DataFactory = {
  createProject: (input, user) => ({
    brandId: input.brandId || "",
    title: input.title
      ? `【${input.startDate || "NoDate"}】${input.title}`
      : "Untitled Project",
    startDate: input.startDate || new Date().toISOString().split("T")[0],
    endDate: input.endDate || "",
    owner: user?.name || "Unknown",
    status: "active",
    createdAt: new Date().toISOString(),
  }),
  createSubProject: (input, user) => ({
    parentId: input.parentId || "",
    title: input.title || "Untitled SubProject",
    assignee: input.assignee || "Unassigned",
    currentHandler: input.assignee || "Unassigned",
    status: "setup",
    startDate: new Date().toISOString().split("T")[0],
    endDate: "",
    lastHandoffDate: new Date().toISOString().split("T")[0],
    milestones: [],
    events: [],
    links: [],
    comments: [],
    tags: input.tags || [],
    delayReason: "",
    delayRemark: "",
    finalDelayDays: 0,
    createdAt: new Date().toISOString(),
  }),
};

// 1. 定義路由組件 (為了不改寫 HTML，我們用一個空的「佔位組件」即可)
const DummyComponent = { template: "<div></div>" };

// 2. 定義網址規則
const routes = [
  // 首頁 -> 對應 dashboard
  { path: "/", name: "dashboard", component: DummyComponent },

  // 歷史報表
  { path: "/report", name: "report", component: DummyComponent },

  // 工作區
  { path: "/workspace", name: "workspace", component: DummyComponent },

  // 母專案詳情 (:pid 是動態參數，例如 P12345)
  { path: "/project/:pid", name: "parent", component: DummyComponent },

  // 子專案詳情
  { path: "/project/:pid/sub/:sid", name: "sub", component: DummyComponent },
];

// 3. 建立 Router 實體
const router = VueRouter.createRouter({
  // 使用 Hash 模式 (網址會像 index.html#/project/123)，這樣不用設定 Server
  history: VueRouter.createWebHistory("/mkt-dashboard/"),
  routes,
});

const app = createApp({
  data() {
    return {
      taskViewMode: "list",
      isDashboardLoading: false,
      isSidebarCollapsed: false,
      userParams: null,
      authForm: {
        email: "",
        password: "",
        name: "",
        team: "digital",
        role: "member",
      },
      isRegisterMode: false,
      authError: "",
      currentView: "dashboard",
      selectedDashboardBrand: "all",
      sidebarSearch: "",
      subProjectSearch: "", // [New] 子專案搜尋關鍵字
      brandExpandedState: {},
      historyStack: [],
      currentYear: new Date().getFullYear(),
      currentMonth: new Date().getMonth() + 1,
      filterStatus: "all",
      users: [],
      currentUserId: null,
      brands: [],

      // [效能優化] 資料拆分
      activeParents: [],
      activeSubs: [],
      historyParents: [],
      historySubs: [],
      isHistoryLoaded: false,
      isLoading: false,

      indexedSubsByParent: {},
      indexedBrandMap: {},
      indexedParentMap: {},
      currentParentProject: null,
      currentSubProject: null,
      calendarSideEvent: null,
      showProjectModal: false,
      projectForm: {},
      showSubProjectModal: false,
      subProjectForm: {},
      showEditBranchModal: false,
      editBranchForm: {},
      setupForm: { startDate: "", endDate: "", milestones: [] },
      showEventModal: false,
      eventForm: {},
      showDelayReasonModal: false,
      delayForm: {},
      modalMode: "sub_complete",
      showArchived: false,
      showMemberDetailModal: false,
      currentMemberDetail: { name: "", team: "", role: "" },
      memberDetailData: {
        active: { tasks: [] },
        overall: { projects: [], reasons: [] },
      },
      showNotifications: false,
      notifications: [],
      detailTab: "overview",
      newComment: "",
      showMentionList: false,
      calendarYear: new Date().getFullYear(),
      calendarMonth: new Date().getMonth() + 1,
      memberDetailYear: "all",
      teamMap: {
        digital: "數位課",
        design: "設計課",
        mkgt: "行銷部",
        brand: "品牌課",
        pr: "公關課",
      },
      roleMap: {
        director: "部主管",
        manager: "課主管",
        member: "職員",
        admin: "神",
      },
      statusMap: {
        setup: "規劃中",
        in_progress: "執行中",
        completed: "已結案",
        aborted: "已中止",
        archived: "已歸檔", // UI Map
      },
      dataReady: false,
      isSubmitting: false,
      tempCompletionData: null,
      ganttCellWidth: 40,
      isDraggingGantt: false,
      startGanttX: 0,
      scrollLeftGantt: 0,
      workspaceTab: "tasks",
      showMobileSidebar: false,
      hasCheckedDailyTasks: false,

      // 快速檢視視窗
      showQuickViewModal: false,
      quickViewData: null,

      commonLinks: [
        {
          title: "棉花糖人資系統",
          url: "https://att.upyoung.com.tw:4431/",
          icon: "fas fa-user-clock",
        },
        {
          title: "BPM簽呈系統",
          url: "https://bpm.upyoung.com.tw:8011/YZSoft/login/2020/?ReturnUrl=%2f",
          icon: "fas fa-file-signature",
        },
        {
          title: "上洋共用資料夾",
          url: "https://drive.google.com/drive/folders/1PLz8UKxUkG2EGctAJQ7GTm3VfgFm4P7G",
          icon: "fab fa-google-drive",
        },
        {
          title: "設計需求表",
          url: "https://docs.google.com/spreadsheets/d/1Ioqg6VDWknm-6gbF6CfcShI0d1nu9g2yfbfjSg46_BQ/edit#gid=0",
          icon: "fas fa-palette",
        },
        {
          title: "2025總預算 Forecast",
          url: "https://docs.google.com/spreadsheets/d/1dgrFSVGK5CzW6Sozb6WfeapXV4CVzsgi/edit?gid=2012342468#gid=2012342468",
          icon: "fas fa-chart-line",
        },
      ],
      isCommonLinksExpanded: false,
      archiveSearch: "",
      // [New] 側邊欄調整相關
      sidebarWidth: 256, // 預設寬度 (px)
      isResizingSidebar: false,
      predefinedTags: ["急件", "設計", "數位廣告", "官網"],
      newTagInput: "", // 用來暫存輸入框的內容
      // [New] 專案模板定義 (SOP 資料庫)
      projectTemplates: [
        {
          name: "數位廣告規劃",
          milestones: [
            { title: "提給廠商brief" },
            { title: "收到cue" },
            { title: "完成簽呈並上簽" },
            { title: "簽呈完成" },
          ],
        },
        {
          name: "社群貼文製作",
          milestones: [
            { title: "提供設計Brief+文案" },
            { title: "設計初提" },
            { title: "設計定案" },
            { title: "確認並排程" },
          ],
        },
        {
          name: "提案簽呈",
          milestones: [
            { title: "撰寫簽呈" },
            { title: "送出簽呈" },
            { title: "簽呈退回" },
            { title: "再次送出簽呈退" },
            { title: "簽呈簽核完畢" },
            { title: "合約簽呈提出" },
            { title: "合約簽呈確認" },
          ],
        },
        {
          name: "名單",
          milestones: [{ title: "提供名單" }],
        },
      ],
      selectedTemplateIndex: "", // 用來綁定下拉選單
      // [New] 看板相關資料
      localFocusIds: [], // 儲存「今日專注」的 ID 列表 (會同步到 Firebase)

      cheerQuotes: [
        "太強了！今天的進度完全掌控中！",
        "工作效率高到嚇人，去喝杯拿鐵吧！",
        "老闆如果看到這個畫面，一定會幫你加薪！",
        "今天的你，閃閃發光！",
        "收工！要不要提早五分鐘下班？",
      ],
      currentCheer: "今日任務已完成！",
      dragOptions: {
        animation: 200,
        group: "kanban", // 預設群組名稱
        disabled: false,
        ghostClass: "sortable-ghost", // 殘影樣式 (還是會有)

        // 👇👇👇 關鍵修改：改為 false (使用原生拖曳，解決所有卡頓問題) 👇👇👇
        forceFallback: false,

        delay: 0,
        touchStartThreshold: 3,
      },
      // [New] 彩蛋變數
        pokeCount: 0, // 計算戳了幾下
        headerTitle: "我的待辦任務", // 標題文字 (改成變數控制)
        isHeaderSpinning: false, // 控制旋轉動畫
    };
  },
// [修正] 整合了路由、登入驗證、以及 Konami Code 監聽
  async mounted() {
    // ------------------------------------------------------------
    // 1. 原有的 Router 網址監聽 (保持不動)
    // ------------------------------------------------------------
    router.afterEach((to) => {
      this.handleRouteUpdate(to);
    });

    // ------------------------------------------------------------
    // 2. 原有的 Auth 登入狀態監聽 (保持不動)
    // ------------------------------------------------------------
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        this.userParams = user;
        const q = query(
          collection(db, "users"),
          where("email", "==", user.email)
        );
        const snapshot = await getDocs(q);
        if (!snapshot.empty) this.currentUserId = snapshot.docs[0].id;
        else {
          const newUser = {
            name: user.email.split("@")[0],
            email: user.email,
            role: "member",
            team: "mkgt",
          };
          const docRef = await addDoc(collection(db, "users"), newUser);
          this.currentUserId = docRef.id;
        }
        this.initListeners();
      } else {
        this.userParams = null;
        this.currentUserId = null;
        this.dataReady = false;
      }
    });

    // ------------------------------------------------------------
    // 3. [New] 彩蛋監聽器：Konami Code (上上下下左右左右 B A)
    // ------------------------------------------------------------
    const konamiCode = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
    let cursor = 0;

    window.addEventListener('keydown', (e) => {
        // 取得按鍵 (轉小寫以防大小寫問題)
        const key = e.key.toLowerCase();
        // 取得目標按鍵 (也轉小寫)
        const targetKey = konamiCode[cursor].toLowerCase();

        // 比對按鍵
        if (key === targetKey) {
            cursor++; // 對了就下一關
            
            // 如果全部輸入正確
            if (cursor === konamiCode.length) {
                console.log("Konami Code Activated! 🚀");
                
                // 呼叫放煙火的方法 (請確認 methods 裡有寫 triggerSuperParty)
                if (this.triggerSuperParty) {
                    this.triggerSuperParty();
                } 
                cursor = 0; // 重置，準備下一次
            }
        } else {
            cursor = 0; // 按錯任何一個鍵就重來
        }
    });
  },
  computed: {
    // [New] 自動計算年份清單
    availableYears() {
      const startYear = 2025;
      const currentYear = new Date().getFullYear();
      const endYear = currentYear + 1;
      const years = [];
      for (let y = startYear; y <= endYear; y++) {
        years.push(y);
      }
      return years;
    },
    // [效能優化] 合併活躍與歷史資料
    rawParents() {
      // 確保沒有重複 ID (如果補抓時重複)
      const map = new Map();
      [...this.activeParents, ...this.historyParents].forEach((p) =>
        map.set(p.id, p)
      );
      return Array.from(map.values());
    },
    rawSubs() {
      const map = new Map();
      [...this.activeSubs, ...this.historySubs].forEach((s) =>
        map.set(s.id, s)
      );
      return Array.from(map.values());
    },

    currentUser() {
      return (
        (this.users || []).find((u) => u.id === this.currentUserId) || {
          name: "Guest",
          team: "mkgt",
          role: "member",
        }
      );
    },
    // [權限修正] 只有「負責人」跟「當下執行者」可以修改內容
    canEditSubProject() {
      // 1. 基本防呆
      if (!this.currentSubProject) return false;

      // 2. Admin 擁有最高權限 (保留此行以便您進行系統維護/救援)
      if (this.currentUser.role === "admin") return true;

      // 3. 狀態檢查：如果專案已經結束 (歸檔/中止/完成)，原則上鎖定不給改
      // (除非您希望結案後還能改，就把這段拿掉)
      if (
        this.currentSubProject.status === "archived" ||
        this.currentSubProject.status === "aborted" ||
        this.currentSubProject.status === "completed"
      ) {
        return false;
      }

      // 4. [核心修改] 比對使用者名稱
      const isAssignee =
        this.currentSubProject.assignee === this.currentUser.name;
      const isHandler =
        this.currentSubProject.currentHandler === this.currentUser.name;

      // 只有這兩個人 (或 Admin) 回傳 true
      return isAssignee || isHandler;
    },
    sortedBrands() {
      return [...this.brands].sort((a, b) =>
        a.name.localeCompare(b.name, "zh-TW")
      );
    },
    visibleBrands() {
      if (!this.sidebarSearch) return this.sortedBrands;
      const search = this.sidebarSearch.toLowerCase();
      return this.sortedBrands.filter((b) => {
        if (b.name.toLowerCase().includes(search)) return true;
        const projects = this.rawParents.filter(
          (p) => p.brandId === b.id && p.status === "active"
        );
        return projects.some((p) => p.title.toLowerCase().includes(search));
      });
    },
    sortedMilestones() {
      if (!this.currentSubProject) return [];
      return [...(this.currentSubProject.milestones || [])].sort(
        (a, b) => new Date(a.date) - new Date(b.date)
      );
    },
    // [修正] 歸檔專案篩選器 (包含 aborted 與 archived)
    archivedProjects() {
      if (!this.rawParents) return [];

      // 1. 先篩選狀態
      let list = this.rawParents.filter(
        (p) => p.status === "archived" || p.status === "aborted"
      );

      // 2. [New] 再篩選關鍵字
      if (this.archiveSearch) {
        const key = this.archiveSearch.toLowerCase();
        list = list.filter((p) => p.title.toLowerCase().includes(key));
      }

      return list;
    },
    unreadNotificationsCount() {
      return this.notifications.filter((n) => !n.read).length;
    },
    modalTitle() {
      if (this.modalMode === "parent_abort") return "中止母專案";
      if (this.modalMode === "sub_abort") return "中止子專案";
      if (this.modalMode === "sub_delay_complete")
        return "專案延誤結案 - 請說明原因";
      return "確認結案 (完成)";
    },
    getSubsForParent() {
      return (pid) => this.indexedSubsByParent[pid] || [];
    },
    // [New] 根據搜尋關鍵字過濾子專案
    filteredSubProjects() {
      if (!this.currentParentProject) return [];
      const allSubs = this.getSortedSubs(this.currentParentProject.id);
      if (!this.subProjectSearch) return allSubs;
      const keyword = this.subProjectSearch.toLowerCase();
      return allSubs.filter(
        (sp) =>
          sp.title.toLowerCase().includes(keyword) ||
          sp.assignee.toLowerCase().includes(keyword) ||
          (this.statusMap[sp.status] &&
            this.statusMap[sp.status].includes(keyword))
      );
    },

    // [核心] 待辦清單邏輯
    myHandledBranches() {
      const list = [];
      this.rawParents.forEach((p) => {
        const subs = this.indexedSubsByParent[p.id] || [];
        const brandName = this.indexedBrandMap[p.brandId] || "Unknown";
        subs.forEach((sp) => {
          // 1. 篩選：執行中 且 球在自己手上
          if (
            sp.currentHandler === this.currentUser.name &&
            sp.status === "in_progress"
          ) {
            // 2. [New] 預先計算「當前目標」是什麼
            let targetDate = sp.endDate || "9999-12-31";
            let targetLabel = "專案截止";
            let isMilestone = false;

            if (sp.milestones && sp.milestones.length > 0) {
              // 排序節點
              const sorted = [...sp.milestones].sort(
                (m1, m2) => new Date(m1.date) - new Date(m2.date)
              );
              // 找第一個沒完成的
              const nextMs = sorted.find((m) => !m.isCompleted);

              if (nextMs) {
                targetDate = nextMs.date;
                targetLabel = nextMs.title; // 節點名稱
                isMilestone = true;
              }
            }

            // 將計算結果包進物件回傳
            list.push({
              brand: { name: brandName },
              parent: p,
              sub: sp,
              // 額外資訊供畫面顯示
              displayInfo: { targetDate, targetLabel, isMilestone },
            });
          }
        });
      });

      // 3. 排序：依照剛剛算好的 targetDate
      return list.sort((a, b) => {
        const dateA = new Date(a.displayInfo.targetDate);
        const dateB = new Date(b.displayInfo.targetDate);

        // 日期越近越上面
        if (dateA.getTime() !== dateB.getTime()) return dateA - dateB;

        // 同一天則比滯留天數
        return this.getDaysHeld(b.sub) - this.getDaysHeld(a.sub);
      });
    },
    allSubProjects() {
      const list = [];
      this.rawParents.forEach((p) => {
        if (
          this.selectedDashboardBrand !== "all" &&
          p.brandId !== this.selectedDashboardBrand
        )
          return;
        const subs = this.indexedSubsByParent[p.id] || [];
        const brandName = this.indexedBrandMap[p.brandId] || "Unknown";
        subs.forEach((sp) => {
          list.push({ brand: { name: brandName }, parent: p, branch: sp });
        });
      });
      return list;
    },
    filteredMonitorList() {
      // 1. 基礎篩選：只抓出「執行中 (in_progress)」的案件
      const candidates = this.allSubProjects.filter(
        (i) => i.branch.status === "in_progress"
      );

      // 2. 排序 (保持原本邏輯：母案日期 -> 母案標題 -> 子案日期)
      candidates.sort((a, b) => {
        const dateA = new Date(a.parent.startDate || "1970-01-01");
        const dateB = new Date(b.parent.startDate || "1970-01-01");
        if (dateA.getTime() !== dateB.getTime()) return dateA - dateB;
        if (a.parent.title !== b.parent.title)
          return a.parent.title.localeCompare(b.parent.title, "zh-TW");
        const subEndA = new Date(a.branch.endDate || "9999-12-31");
        const subEndB = new Date(b.branch.endDate || "9999-12-31");
        return subEndA - subEndB;
      });

      // 3. 根據下拉選單進行狀態篩選
      if (this.filterStatus === "all") return candidates;

      // 比對專案健康度 (type 會是 'delay', 'lag', 'normal')
      return candidates.filter(
        (i) => this.getProjectHealth(i.branch).type === this.filterStatus
      );
    },
    scopedStats() {
      let activeCount = 0,
        activeDelay = 0,
        activeDelayDays = 0;
      let overallCount = 0,
        overallDelay = 0,
        overallDelayDays = 0;
      let activeReasons = {},
        overallReasons = {},
        archivedList = [];
      let totalPeriodHours = 0;
      this.allSubProjects.forEach((item) => {
        const sp = item.branch;
        (sp.events || []).forEach((ev) => {
          if (this.checkDateMatch(ev.date))
            totalPeriodHours += Number(ev.hours || 0);
        });
        if (sp.status === "in_progress") {
          activeCount++;
          const d = this.getProjectHealth(sp);
          if (d.type === "delay") {
            activeDelay++;
            activeDelayDays += d.days;
          }
          if (sp.delayReason)
            activeReasons[sp.delayReason] =
              (activeReasons[sp.delayReason] || 0) + 1;
        }
        if (this.currentView === "history_report") {
          const isMatch = this.checkDateMatch(sp.completedDate || sp.endDate);
          if (
            (sp.status === "completed" || sp.status === "aborted") &&
            isMatch
          ) {
            overallCount++;
            sp.actHours = this.calcSubProjectHours(sp);
            archivedList.push(item);
            const d = sp.finalDelayDays || 0;
            if (d > 0 && sp.status !== "aborted") {
              overallDelay++;
              overallDelayDays += d;
            }
            if (sp.delayReason)
              overallReasons[sp.delayReason] =
                (overallReasons[sp.delayReason] || 0) + 1;
          }
        }
      });
      return {
        active: {
          count: activeCount,
          delayRate: activeCount
            ? Math.round((activeDelay / activeCount) * 100)
            : 0,
          totalDelayDays: activeDelayDays,
          reasonList: this.objToArr(activeReasons, activeCount),
        },
        overall: {
          totalProjects: overallCount,
          delayRate: overallCount
            ? Math.round((overallDelay / overallCount) * 100)
            : 0,
          totalDelayDays: overallDelayDays,
          reasonList: this.objToArr(overallReasons, overallCount),
        },
        archivedList,

        // ★ 這裡加上 Math.round (強制進位)
        archivedHours: Math.round(totalPeriodHours * 10) / 10,
      };
    },
    currentProjectStats() {
      if (!this.currentParentProject) return {};
      const subs = this.indexedSubsByParent[this.currentParentProject.id] || [];
      let act = 0,
        delays = 0,
        completed = 0,
        totalPercent = 0,
        maxDelay = 0;
      subs.forEach((sp) => {
        act += this.calcSubProjectHours(sp); // 呼叫已修正的計算函式
        const h = this.getProjectHealth(sp);
        if (sp.status !== "aborted" && h.type === "delay") {
          delays++;
          maxDelay = Math.max(maxDelay, h.days);
        }
        if (sp.status === "completed") completed++;
        const tm = sp.milestones?.length || 0;
        const dm = sp.milestones?.filter((m) => m.isCompleted).length || 0;
        totalPercent += tm ? (dm / tm) * 100 : 0;
      });
      return {
        total: subs.length,
        completed,
        act: Math.round(act * 10) / 10, // 再次確保加總進位
        delays,
        maxDelay,
        progress: subs.length ? Math.round(totalPercent / subs.length) : 0,
      };
    },
    calendarDays() {
      const days = [];
      const firstDayOfMonth = new Date(
        this.calendarYear,
        this.calendarMonth - 1,
        1
      );
      const lastDayOfMonth = new Date(this.calendarYear, this.calendarMonth, 0);
      const startDay = new Date(firstDayOfMonth);
      startDay.setDate(1 - firstDayOfMonth.getDay());
      const endDay = new Date(lastDayOfMonth);
      endDay.setDate(lastDayOfMonth.getDate() + (6 - lastDayOfMonth.getDay()));
      const totalDays =
        Math.round((endDay - startDay) / (1000 * 60 * 60 * 24)) + 1;
      const todayStr = new Date().toLocaleDateString("en-CA", {
        timeZone: "Asia/Taipei",
      });

      for (let i = 0; i < totalDays; i++) {
        const current = new Date(startDay);
        current.setDate(startDay.getDate() + i);
        const isoDate = current.toLocaleDateString("en-CA", {
          timeZone: "Asia/Taipei",
        });
        const isCurrentMonth = current.getMonth() === this.calendarMonth - 1;
        days.push({
          date: current.getDate(),
          isCurrentMonth,
          isToday: isoDate === todayStr,
          isoDate,
          events: [],
        });
      }

      this.allSubProjects.forEach((item) => {
        const sp = item.branch;
        const isMine =
          item.parent.owner === this.currentUser.name ||
          sp.assignee === this.currentUser.name ||
          sp.currentHandler === this.currentUser.name;
        if (!isMine) return;

        const brandPrefix = item.brand ? `[${item.brand.name}] ` : "";

        if (sp.endDate) {
          const day = days.find((d) => d.isoDate === sp.endDate);
          if (day)
            day.events.push({
              id: sp.id,
              title: `${brandPrefix}${sp.title}`,
              type: "deadline",
              sub: sp,
              parent: item.parent,
            });
        }
        (sp.milestones || []).forEach((m) => {
          if (m.date) {
            const day = days.find((d) => d.isoDate === m.date);
            if (day)
              day.events.push({
                id: m.id,
                title: `${brandPrefix} ${m.title}`,
                type: "milestone",
                sub: sp,
                parent: item.parent,
              });
          }
        });
      });
      return days;
    },
    // 在 computed: { ... } 裡面

    memberStats() {
      // [修改] 先過濾掉 admin 角色，再進行 map 計算
      return this.users
        .filter((u) => u.role !== "admin")
        .map((m) => {
          let active = 0,
            delay = 0;
          this.allSubProjects.forEach((item) => {
            const sp = item.branch;
            if (sp.assignee === m.name || sp.currentHandler === m.name) {
              if (sp.status === "in_progress") active++;
              if (
                sp.status !== "aborted" &&
                this.getProjectHealth(sp).type === "delay"
              )
                delay++;
            }
          });
          return {
            id: m.id,
            name: m.name,
            team: m.team,
            activeBranches: active,
            delayCount: delay,
          };
        });
    },
    myOwnedBranches() {
      const list = [];
      this.rawParents
        .filter(
          (p) => p.owner === this.currentUser.name && p.status === "active"
        )
        .forEach((p) => {
          list.push({
            brand: { name: this.indexedBrandMap[p.brandId] },
            project: p,
            isParent: true,
            sortDate: p.endDate,
          });
        });
      this.allSubProjects
        .filter(
          (i) =>
            i.branch.assignee === this.currentUser.name &&
            i.branch.status !== "completed" &&
            i.branch.status !== "aborted"
        )
        .forEach((i) => {
          list.push({
            brand: i.brand,
            parent: i.parent,
            sub: i.branch,
            isParent: false,
            sortDate: i.branch.endDate,
          });
        });
      return list.sort((a, b) => {
        if (a.isParent && !b.isParent) return -1;
        if (!a.isParent && b.isParent) return 1;
        const da = a.sortDate ? new Date(a.sortDate) : new Date(9999, 11, 31);
        const db = b.sortDate ? new Date(b.sortDate) : new Date(9999, 11, 31);
        return da - db;
      });
    },
    incompleteMilestones() {
      if (!this.currentSubProject?.milestones) return [];
      const sorted = [...this.currentSubProject.milestones].sort(
        (a, b) => new Date(a.date) - new Date(b.date)
      );
      return sorted.filter((m) => !m.isCompleted).slice(0, 1);
    },
    // 在 computed: { ... } 裡面

    memberHoursStats() {
      const stats = {};

      // [修改] 初始化時，只為「非 admin」的使用者建立統計欄位
      this.users
        .filter((u) => u.role !== "admin")
        .forEach(
          (u) => (stats[u.name] = { name: u.name, team: u.team, hours: 0 })
        );

      this.allSubProjects.forEach((item) => {
        const sp = item.branch;
        if (sp.events) {
          sp.events.forEach((ev) => {
            // 注意：因為 stats 裡面沒有 admin 的 key，所以 admin 的工時會因為 stats[ev.worker] 為 undefined 而自動被忽略
            if (this.checkDateMatch(ev.date) && stats[ev.worker])
              stats[ev.worker].hours += Number(ev.hours || 0);
          });
        }
      });

      return Object.values(stats)
        .map((s) => ({
          ...s,
          hours: Math.round(s.hours * 10) / 10,
        }))
        .sort((a, b) => b.hours - a.hours);
    },
    departmentHours() {
      const deptStats = {};
      let totalAll = 0;
      this.memberHoursStats.forEach((m) => {
        if (!deptStats[m.team]) deptStats[m.team] = 0;
        deptStats[m.team] += m.hours;
        totalAll += m.hours;
      });
      return Object.entries(deptStats)
        .map(([team, hours]) => ({
          name: team,
          hours: Math.round(hours * 10) / 10, // [修改] 這裡也進位
          percent: totalAll ? Math.round((hours / totalAll) * 100) : 0,
        }))
        .sort((a, b) => b.hours - a.hours);
    },

    // [修正] 看板資料分類 (含搜尋過濾 + 智慧排序)
    kanbanColumns() {
      const myTasks = [];
      const focusIds = this.localFocusIds || [];

      // 1. 取得搜尋關鍵字 (轉小寫，去頭尾空白)
      const keyword = (this.subProjectSearch || "").toLowerCase().trim();

      // 2. 抓取資料並篩選
      this.rawParents.forEach((p) => {
        const subs = this.indexedSubsByParent[p.id] || [];
        subs.forEach((s) => {
          // A. 權限判斷：球在我手上 OR (我是負責人且未指派)
          if (
            s.currentHandler === this.currentUser.name ||
            (s.assignee === this.currentUser.name &&
              s.currentHandler === "Unassigned")
          ) {
            // B. 狀態判斷：排除已完成、封存、終止
            if (
              s.status !== "completed" &&
              s.status !== "archived" &&
              s.status !== "aborted"
            ) {
              // C. 搜尋過濾邏輯
              if (keyword) {
                const matchTitle = s.title.toLowerCase().includes(keyword);
                const matchParent = p.title.toLowerCase().includes(keyword);
                // 取得品牌名稱進行搜尋
                const brandName = this.indexedBrandMap[p.brandId] || "";
                const matchBrand = brandName.toLowerCase().includes(keyword);

                // 如果 標題、母專案、品牌 都不符合，就跳過
                if (!matchTitle && !matchParent && !matchBrand) {
                  return;
                }
              }

              // 符合條件，加入列表 (補上顯示所需的 parentName 等資訊)
              myTasks.push({
                ...s,
                parentName: p.title,
                brandName: this.indexedBrandMap[p.brandId],
                parentObj: p,
              });
            }
          }
        });
      });

      // 3. 定義排序權重函式 (讓看板順序跟列表模式一模一樣)
      // 邏輯：嚴重延遲 > 快到期(落後) > 日期越早越前
      const getSortScore = (item) => {
        const now = new Date();
        const todayStr = now.toISOString().split("T")[0];

        // 找出「比較基準日」 (優先用最近的未完成里程碑，沒有才用結案日)
        let targetDateStr = item.endDate || "9999-12-31";
        if (item.milestones && item.milestones.length > 0) {
          const nextMs = item.milestones
            .filter((m) => !m.isCompleted && m.date)
            .sort((a, b) => new Date(a.date) - new Date(b.date))[0];
          if (nextMs) {
            targetDateStr = nextMs.date;
          }
        }

        const targetDate = new Date(targetDateStr);
        let score = targetDate.getTime(); // 基礎分數是時間戳記

        // 加權扣分 (讓急件排到最上面，分數越小越前面)
        if (targetDateStr < todayStr) {
          score -= 1000000000000; // 延遲 (Delay): 扣超大分，保證置頂
        } else if (
          new Date(now.getTime() + 2 * 86400000).toISOString().split("T")[0] >
          targetDateStr
        ) {
          score -= 100000000000; // 落後 (Lag): 扣大分，排第二順位
        }

        return score;
      };

      // 4. 建立排序函式
      const sortFn = (a, b) => getSortScore(a) - getSortScore(b);

      // 5. 回傳分類結果
      return {
        // 待規劃 (Inbox): 通常依照建立順序，若想依照日期排也可加上 .sort(sortFn)
        inbox: myTasks.filter((t) => t.status === "setup"),

        // 今日專注 (Today): 依照急迫性排序
        today: myTasks
          .filter(
            (t) =>
              t.status === "in_progress" &&
              !t.isWaitingForManager &&
              focusIds.includes(t.id)
          )
          .sort(sortFn),

        // 待辦清單 (Backlog): 依照急迫性排序
        backlog: myTasks
          .filter(
            (t) =>
              t.status === "in_progress" &&
              !t.isWaitingForManager &&
              !focusIds.includes(t.id)
          )
          .sort(sortFn),

        // 等待審核 (Review): 依照急迫性排序
        review: myTasks
          .filter((t) => t.status === "in_progress" && t.isWaitingForManager)
          .sort(sortFn),
      };
    },
  },
  watch: {
    // [效能優化] 觸發載入歷史資料 (檢視專案詳情、歷史報表、歸檔區展開)
    currentView(newView) {
      if (newView === "history_report" || newView === "parent_detail") {
        this.loadHistoryData();
      }
    },
    showArchived(isShown) {
      if (isShown) {
        console.log("展開歸檔區，正在補抓資料...");
        this.loadHistoryData();
      }
    },
    memberDetailYear(newYear) {
      if (newYear !== "all" && newYear < new Date().getFullYear()) {
        this.loadHistoryData();
      }
    },

    // [New] 監聽資料準備好沒 (針對重新整理網頁的情況)
    dataReady(isReady) {
      if (isReady) {
        // 資料載入完畢後，立刻根據目前網址設定畫面
        this.handleRouteUpdate(this.$route);
      }
    },
  },
  watch: {
    "kanbanColumns.today"(newVal) {
      if (newVal.length === 0) {
        this.refreshCheer();
      }
    },
  },
  methods: {
    refreshCheer() {
      const idx = Math.floor(Math.random() * this.cheerQuotes.length);
      this.currentCheer = this.cheerQuotes[idx];
    },
    requestNotificationPermission() {
      if (!("Notification" in window)) return;
      if (
        Notification.permission !== "granted" &&
        Notification.permission !== "denied"
      ) {
        Notification.requestPermission();
      }
    },
    sendBrowserNotification(title, body, tag = null) {
      if (Notification.permission === "granted") {
        new Notification(`[上洋戰情室] ${title}`, {
          body,
          tag,
          icon: "https://www.upyoung.com.tw/assets/images/logo.png",
        });
      }
    },
    checkDailyTasks() {
      if (this.hasCheckedDailyTasks) return;
      const today = new Date().toLocaleDateString("en-CA", {
        timeZone: "Asia/Taipei",
      });
      const myTasks = this.myHandledBranches;
      myTasks.forEach((item) => {
        const sp = item.sub;
        if (!sp.endDate) return;
        if (sp.endDate === today) {
          this.sendBrowserNotification(
            "今日截止提醒",
            `通知原因：工作「${sp.title}」今日截止，請確認進度。`,
            `today-${sp.id}`
          );
        } else if (sp.endDate < today) {
          const days = Math.floor(
            (new Date(today) - new Date(sp.endDate)) / 86400000
          );
          this.sendBrowserNotification(
            "逾期處理提醒",
            `通知原因：工作「${sp.title}」已逾期 ${days} 天尚未處理完成。`,
            `overdue-${sp.id}`
          );
        }
      });
      this.hasCheckedDailyTasks = true;
    },
    initListeners() {
      try {
        // 1. 請求通知權限 (保留)
        this.requestNotificationPermission();

        // 2. [修改] Users 監聽 (同步讀取今日專注清單)
        onSnapshot(collection(db, "users"), (s) => {
          this.users = s.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .sort((a, b) => (a.team || "").localeCompare(b.team || ""));

          // [New] 如果抓到了當前使用者的資料，同步更新 localFocusIds
          if (this.currentUserId) {
            const myself = this.users.find((u) => u.id === this.currentUserId);
            if (myself && myself.focusIds) {
              this.localFocusIds = myself.focusIds;
            }
          }

          if (!this.dataReady) this.dataReady = true;
        });

        // 3. [保留即時監聽] Brands (品牌資料量極小)
        onSnapshot(collection(db, "brands"), (s) => {
          this.brands = s.docs.map((d) => ({ id: d.id, ...d.data() }));
          this.rebuildBrandMap();
        });

        // --- [修改重點] ---
        // 4. [效能優化] 移除原本對 projects 和 sub_projects 的 onSnapshot
        // 改成呼叫 fetchDashboardData() 來一次性拉取資料
        this.fetchDashboardData();
        // ------------------

        // 5. [保留即時監聽] 通知中心 (必須即時，否則失去通知意義)
        this.$watch(
          () => this.currentUser?.name,
          (newVal) => {
            if (newVal) {
              onSnapshot(
                query(
                  collection(db, "notifications"),
                  where("recipient", "==", newVal)
                ),
                (snap) => {
                  const oldLen = this.notifications.length;
                  this.notifications = snap.docs
                    .map((d) => ({ id: d.id, ...d.data() }))
                    .sort((a, b) => new Date(b.time) - new Date(a.time));

                  // 檢查是否有新通知並發送瀏覽器推播
                  if (this.dataReady && this.notifications.length > oldLen) {
                    const latest = this.notifications[0];
                    if (
                      !latest.read &&
                      latest.sender !== this.currentUser.name
                    ) {
                      this.sendBrowserNotification(
                        "收到新通知",
                        `通知原因：${latest.message}`,
                        `notif-${latest.id}`
                      );
                    }
                  }
                }
              );
            }
          }
        );
      } catch (e) {
        console.error("Init Listeners Error:", e);
        // 萬一出錯，至少讓畫面不要卡死
        this.dataReady = true;
      }
    },
    // [效能優化] 改為手動拉取儀表板資料 (取代 onSnapshot)
    async fetchDashboardData() {
      if (this.isDashboardLoading) return;
      this.isDashboardLoading = true;

      // 如果您有做 Toast 優化，這裡可以加 this.showToast('更新中', '正在同步儀表板數據...', 'info');

      try {
        // 定義資料轉換函數 (跟原本一樣)
        const safeProject = (d) => ({
          id: d.id,
          brandId: "",
          title: "Untitled",
          status: "active",
          startDate: "",
          endDate: "",
          owner: "Unknown",
          ...d.data(),
        });
        const safeSub = (d) => {
          const data = d.data();
          return {
            id: d.id,
            parentId: "",
            title: "Untitled",
            status: "setup",
            ...data,
            milestones: data.milestones || [],
            events: data.events || [],
            links: data.links || [],
            comments: data.comments || [],
          };
        };

        // 1. 抓取「執行中 (active)」的母專案
        const qProjects = query(
          collection(db, "projects"),
          where("status", "==", "active")
        );
        const snapProj = await getDocs(qProjects);
        this.activeParents = snapProj.docs.map((d) => safeProject(d));

        // 2. 抓取「規劃中 (setup) 或 執行中 (in_progress)」的子專案
        const qSubs = query(
          collection(db, "sub_projects"),
          where("status", "in", ["setup", "in_progress"])
        );
        const snapSubs = await getDocs(qSubs);
        this.activeSubs = snapSubs.docs.map((d) => safeSub(d));

        // 3. 重建索引與畫面
        this.buildIndexes();

        // 如果有 Toast，可以加 this.showToast('同步完成', '儀表板數據已更新', 'success');
        console.log("儀表板數據已手動更新");
      } catch (e) {
        console.error("更新儀表板失敗", e);
        alert("更新失敗，請檢查網路連線");
      } finally {
        this.isDashboardLoading = false;
      }
    },

    // [New] 延遲載入歷史資料 (補抓 Completed, Aborted, Archived)
    async loadHistoryData() {
      if (this.isHistoryLoaded) return;
      this.isLoading = true;
      console.log("正在下載歷史報表資料..."); // 改用 console.log

      try {
        const safeProject = (d) => ({
          id: d.id,
          brandId: "",
          title: "Untitled",
          status: "active",
          startDate: "",
          endDate: "",
          owner: "Unknown",
          ...d.data(),
        });
        const safeSub = (d) => {
          const data = d.data();
          return {
            id: d.id,
            parentId: "",
            title: "Untitled",
            status: "setup",
            ...data,
            milestones: data.milestones || [],
            events: data.events || [],
            links: data.links || [],
            comments: data.comments || [],
          };
        };

        // [效能優化] 1. 抓母專案：
        // 規則：狀態是歸檔類 + 依照開始日倒序 + 只抓最近 100 筆
        const qHistoryProjects = query(
          collection(db, "projects"),
          where("status", "in", ["completed", "aborted", "archived"]),
          orderBy("startDate", "desc"),
          limit(100) // ★ 限制 100 筆，省錢關鍵
        );
        const snapProj = await getDocs(qHistoryProjects);
        this.historyParents = snapProj.docs.map((d) => safeProject(d));

        // [效能優化] 2. 抓子專案：
        // 規則：狀態是歸檔類 + 依照結束日倒序 + 只抓最近 300 筆
        const qHistorySubs = query(
          collection(db, "sub_projects"),
          where("status", "in", ["completed", "aborted"]),
          orderBy("endDate", "desc"),
          limit(300) // ★ 限制 300 筆
        );
        const snapSubs = await getDocs(qHistorySubs);
        this.historySubs = snapSubs.docs.map((d) => safeSub(d));

        this.isHistoryLoaded = true;
        this.buildIndexes(); // 重建索引讓畫面更新
        console.log(
          `同步完成，已載入 ${this.historyParents.length} 筆歷史專案`
        );
      } catch (err) {
        console.error("補抓歸檔資料失敗", err);

        // 提示索引錯誤 (開發階段必看)
        if (err.message.includes("index")) {
          alert(
            "系統提示：請打開 F12 Console，點擊 Firebase 連結以建立查詢索引 (Index)"
          );
        }
      } finally {
        this.isLoading = false;
      }
    },

    buildIndexes() {
      const subMap = {};
      this.rawSubs.forEach((s) => {
        if (!subMap[s.parentId]) subMap[s.parentId] = [];
        subMap[s.parentId].push(s);
      });
      this.indexedSubsByParent = subMap;
      const pMap = {};
      this.rawParents.forEach((p) => (pMap[p.id] = p));
      this.indexedParentMap = pMap;
      const bMap = {};
      this.brands.forEach((b) => (bMap[b.id] = b.name));
      this.indexedBrandMap = bMap;
    },
    rebuildBrandMap() {
      const bMap = {};
      this.brands.forEach((b) => (bMap[b.id] = b.name));
      this.indexedBrandMap = bMap;
    },

    openMemberDetail(m) {
      this.currentMemberDetail = m;
      this.recalcMemberDetail();
      this.showMemberDetailModal = true;
    },
    recalcMemberDetail() {
      const m = this.currentMemberDetail;
      let activeCount = 0,
        holdDaysSum = 0,
        activeTasks = [],
        overallCount = 0,
        overallDelay = 0,
        overallDelayDays = 0,
        overallReasons = {},
        ownedList = [];

      this.allSubProjects.forEach((item) => {
        const sp = item.branch;
        if (sp.currentHandler === m.name && sp.status === "in_progress") {
          activeCount++;
          const hd = this.getDaysHeld(sp.lastHandoffDate);
          holdDaysSum += hd;
          activeTasks.push({
            brand: item.brand,
            parent: item.parent,
            sub: sp,
            holdDays: hd,
          });
        }
        if (sp.assignee === m.name) {
          // [修改] 年份判斷邏輯優化
          // 如果是「規劃中 (setup)」且還沒填結束日，就改用「開始日」來判斷年份，避免被過濾掉
          let dateForFilter = sp.endDate;
          if (sp.status === "setup" && !dateForFilter) {
            dateForFilter = sp.startDate;
          }

          if (
            this.memberDetailYear === "all" ||
            (dateForFilter && dateForFilter.startsWith(this.memberDetailYear))
          ) {
            overallCount++;
            // ... (原本的邏輯: 計算延遲等) ...

            // [修改] 記得確保這裡有加入 brand (上一各步驟我們加過了，這裡保留)
            ownedList.push({ brand: item.brand, parent: item.parent, sub: sp });
          }
        }
      });

      this.memberDetailData = {
        active: {
          count: activeCount,
          avgHoldDays:
            activeCount === 0 ? 0 : Math.round(holdDaysSum / activeCount),
          tasks: activeTasks.sort((a, b) => b.holdDays - a.holdDays),
        },
        overall: {
          total: overallCount,
          delayRate:
            overallCount === 0
              ? 0
              : Math.round((overallDelay / overallCount) * 100),
          totalDelayDays: overallDelayDays,
          reasons: Object.entries(overallReasons)
            .map(([k, v]) => ({
              name: k,
              count: v,
              percent: Math.round((v / overallCount) * 100) || 0,
            }))
            .sort((a, b) => b.count - a.count),
          projects: ownedList.sort(
            (a, b) => new Date(b.sub.endDate) - new Date(a.sub.endDate)
          ),
        },
      };
    },

    objToArr(obj, total) {
      return Object.entries(obj)
        .map(([k, v]) => ({
          name: k,
          count: v,
          percent: total ? Math.round((v / total) * 100) : 0,
        }))
        .sort((a, b) => b.count - a.count);
    },
    checkDateMatch(dStr) {
      if (!dStr) return false;
      const d = new Date(dStr);
      return (
        d.getFullYear() === this.currentYear &&
        (this.currentMonth === "all" || d.getMonth() + 1 === this.currentMonth)
      );
    },
    toggleAuthMode() {
      this.isRegisterMode = !this.isRegisterMode;
      this.authError = "";
    },
    async handleAuth() {
      try {
        if (this.isRegisterMode) {
          if (!this.authForm.name) throw new Error("請輸入姓名");
          await createUserWithEmailAndPassword(
            auth,
            this.authForm.email,
            this.authForm.password
          );
          await addDoc(collection(db, "users"), {
            email: this.authForm.email,
            name: this.authForm.name,
            team: this.authForm.team,
            role: this.authForm.role,
          });
        } else {
          await signInWithEmailAndPassword(
            auth,
            this.authForm.email,
            this.authForm.password
          );
        }
      } catch (e) {
        this.authError = e.message.replace("Firebase: ", "");
      }
    },
    logout() {
      signOut(auth);
    },
    async addBrand() {
      // [New] 權限檢查
      if (this.currentUser.role !== "admin")
        return alert("權限不足：只有管理者可以新增品牌");

      const n = prompt("輸入新品牌名稱:");
      if (n && n.trim()) {
        await addDoc(collection(db, "brands"), { name: n.trim() });
      }
    },
    toggleBrand(id) {
      this.brandExpandedState[id] = !this.brandExpandedState[id];
    },
    isBrandExpanded(id) {
      if (this.sidebarSearch) return true;
      return !!this.brandExpandedState[id];
    },
    getMatchingProjects(brandId) {
      let projects = this.rawParents.filter(
        (p) => p.brandId === brandId && p.status === "active"
      );
      projects.sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
      if (!this.sidebarSearch) return projects;
      const search = this.sidebarSearch.toLowerCase();
      return projects.filter((p) => p.title.toLowerCase().includes(search));
    },
    getArchivedProjectsByBrand(bid) {
      return this.rawParents.filter(
        (p) =>
          p.brandId === bid &&
          (p.status === "completed" || p.status === "aborted")
      );
    },
    getSortedSubs(pid) {
      const subs = this.indexedSubsByParent[pid] || [];
      return [...subs].sort((a, b) => {
        const aActive = a.status === "in_progress" || a.status === "setup";
        const bActive = b.status === "in_progress" || b.status === "setup";
        if (aActive && !bActive) return -1;
        if (!aActive && bActive) return 1;
        return new Date(a.endDate) - new Date(b.endDate);
      });
    },
    startDrag(e) {
      this.isDraggingGantt = true;
      this.startGanttX = e.pageX - this.$refs.ganttContainer.offsetLeft;
      this.scrollLeftGantt = this.$refs.ganttContainer.scrollLeft;
    },
    doDrag(e) {
      if (!this.isDraggingGantt) return;
      e.preventDefault();
      const x = e.pageX - this.$refs.ganttContainer.offsetLeft;
      const walk = (x - this.startGanttX) * 2;
      this.$refs.ganttContainer.scrollLeft = this.scrollLeftGantt - walk;
    },
    stopDrag() {
      this.isDraggingGantt = false;
    },
    changeGanttZoom(delta) {
      this.ganttCellWidth = Math.max(
        20,
        Math.min(100, this.ganttCellWidth + delta)
      );
    },
    getGanttDays(project) {
      if (!project.startDate || !project.endDate) return [];
      const start = new Date(project.startDate);
      const end = new Date(project.endDate);
      start.setDate(start.getDate() - 2);
      end.setDate(end.getDate() + 5);
      const days = [];
      const curr = new Date(start);
      while (curr <= end) {
        const day = curr.getDay();
        days.push({
          iso: curr.toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" }),
          label: `${curr.getMonth() + 1}/${curr.getDate()}`,
          isWeekend: day === 0 || day === 6,
        });
        curr.setDate(curr.getDate() + 1);
      }
      return days;
    },
    getDynamicGanttBarStyles(sp, parent) {
      if (!sp.startDate || !sp.endDate) return "display: none";
      const allDays = this.getGanttDays(parent);
      if (allDays.length === 0) return "display: none";
      const startDayIndex = allDays.findIndex((d) => d.iso === sp.startDate);
      const endDayIndex = allDays.findIndex((d) => d.iso === sp.endDate);
      if (startDayIndex === -1) return "display: none";
      const left = startDayIndex * this.ganttCellWidth;
      const width =
        ((endDayIndex === -1 ? allDays.length - 1 : endDayIndex) -
          startDayIndex +
          1) *
        this.ganttCellWidth;
      return `left: ${left}px; width: ${Math.max(
        this.ganttCellWidth,
        width
      )}px`;
    },
    openProjectModal(bid) {
      this.projectForm = {
        brandId: bid,
        title: "",
        startDate: new Date().toISOString().split("T")[0],
        endDate: "",
      };
      this.showProjectModal = true;
    },
    async saveProject() {
      if (!this.projectForm.title) return alert("請填寫資訊");
      this.isSubmitting = true;
      try {
        // 1. 產生資料物件
        const newProjectData = DataFactory.createProject(
          this.projectForm,
          this.currentUser
        );

        // 2. 寫入資料庫，並取得新 ID
        const docRef = await addDoc(collection(db, "projects"), newProjectData);

        // 3. [重要] 手動更新前端快取 (因為移除了 onSnapshot)
        const newProject = { id: docRef.id, ...newProjectData };
        this.activeParents.push(newProject);
        // 更新索引 Map，這樣等一下路由才找得到
        this.indexedParentMap[docRef.id] = newProject;

        this.showProjectModal = false;

        // 4. 跳轉到新專案頁面
        this.$router.push({ name: "parent", params: { pid: docRef.id } });

        // 顯示成功訊息 (可選)
        // this.showToast('開案成功', '已建立母專案並跳轉', 'success');
      } catch (e) {
        console.error(e);
        alert("開案失敗：" + e.message);
      } finally {
        this.isSubmitting = false;
      }
    },
    openBranchModal(pid) {
      this.subProjectForm = {
        parentId: pid,
        title: "",
        assignee: this.currentUser.name,
      };
      this.showSubProjectModal = true;
    },

    // [New] 新增標籤 (用於開案或編輯時)
    addTag(targetForm) {
      const val = this.newTagInput.trim();
      if (!val) return;
      if (!targetForm.tags) targetForm.tags = [];
      if (!targetForm.tags.includes(val)) {
        targetForm.tags.push(val);
      }
      this.newTagInput = "";
    },
    // [New] 移除標籤
    removeTag(targetForm, index) {
      targetForm.tags.splice(index, 1);
    },
    // [New] 取得標籤樣式 (根據文字內容給不同顏色，增加識別度)
    getTagStyle(tagName) {
      if (tagName === "急件")
        return "bg-red-100 text-red-600 border border-red-200";
      if (tagName === "設計")
        return "bg-purple-100 text-purple-600 border border-purple-200";
      if (tagName === "數位廣告")
        return "bg-blue-100 text-blue-600 border border-blue-200";
      if (tagName === "官網")
        return "bg-pink-100 text-pink-600 border border-pink-200";
      return "bg-slate-100 text-slate-600 border border-slate-200"; // 預設灰色
    },

    async saveSubProject() {
      if (!this.subProjectForm.title) return alert("請填寫名稱");
      this.isSubmitting = true;
      try {
        // 1. 產生資料物件
        const newSubData = DataFactory.createSubProject(
          this.subProjectForm,
          this.currentUser
        );

        // [防呆] 子專案起點不早於母專案
        const parentObj = this.indexedParentMap[this.subProjectForm.parentId];
        if (parentObj && parentObj.startDate) {
          if (newSubData.startDate < parentObj.startDate) {
            newSubData.startDate = parentObj.startDate;
          }
        }

        // 2. 寫入資料庫，取得 ID
        const docRef = await addDoc(collection(db, "sub_projects"), newSubData);

        // 3. 發送通知 (如果有指派別人)
        if (newSubData.assignee !== this.currentUser.name) {
          this.sendNotification(
            newSubData.assignee,
            "task",
            `您被指派負責新專案: ${newSubData.title}`,
            this.subProjectForm.parentId,
            docRef.id
          );
        }

        // 4. [重要] 手動更新前端快取
        const newSub = { id: docRef.id, ...newSubData };
        this.activeSubs.push(newSub);

        // 手動更新索引 (把新子案塞進對應的母案陣列)
        if (!this.indexedSubsByParent[this.subProjectForm.parentId]) {
          this.indexedSubsByParent[this.subProjectForm.parentId] = [];
        }
        this.indexedSubsByParent[this.subProjectForm.parentId].push(newSub);

        this.showSubProjectModal = false;

        // 5. 跳轉到新子專案頁面
        this.$router.push({
          name: "sub",
          params: { pid: this.subProjectForm.parentId, sid: docRef.id },
        });
      } catch (e) {
        console.error(e);
        alert("開案失敗：" + e.message);
      } finally {
        this.isSubmitting = false;
      }
    },

    openEditBranchModal() {
      this.editBranchForm = JSON.parse(JSON.stringify(this.currentSubProject));
      this.showEditBranchModal = true;
    },

    async saveEditedBranch() {
      this.isSubmitting = true;
      try {
        // 1. [防呆] 日期檢查
        if (
          this.editBranchForm.startDate < this.currentParentProject.startDate
        ) {
          return alert(
            `錯誤：子專案開始日 (${this.editBranchForm.startDate}) 不可早於母專案開始日 (${this.currentParentProject.startDate})`
          );
        }

        // 2. 準備要更新的資料物件 (確保 tags 存在)
        const updateData = {
          ...this.editBranchForm,
          tags: this.editBranchForm.tags || [], // ★ 確保寫入標籤陣列
        };

        // 3. 寫入 Firestore 資料庫
        await updateDoc(
          doc(db, "sub_projects", this.currentSubProject.id),
          updateData
        );

        // 4. 檢查是否更換負責人，發送通知
        // (注意：此時 this.currentSubProject 還是舊資料，正好可以用來比對)
        if (this.editBranchForm.assignee !== this.currentSubProject.assignee) {
          await this.sendNotification(
            this.editBranchForm.assignee,
            "task",
            `您被指派負責專案: ${this.editBranchForm.title}`,
            this.currentParentProject.id,
            this.currentSubProject.id
          );
        }

        // 5. [重要] 手動更新本地快取 (因為移除了 onSnapshot)
        // 使用 Object.assign 直接修改當前物件，讓畫面立刻變更
        Object.assign(this.currentSubProject, updateData);

        this.showEditBranchModal = false;
        // 如果您有做 Toast，可以加這一行
        // this.showToast('更新成功', '子專案設定已儲存', 'success');
      } catch (e) {
        console.error("更新失敗", e);
        alert("儲存變更失敗，請檢查網路");
      } finally {
        this.isSubmitting = false;
      }
    },

    async editParentTitle() {
      const newTitle = prompt(
        "修改母專案名稱:",
        this.currentParentProject.title
      );
      if (
        newTitle &&
        newTitle.trim() !== "" &&
        newTitle !== this.currentParentProject.title
      ) {
        this.currentParentProject.title = newTitle;
        await updateDoc(doc(db, "projects", this.currentParentProject.id), {
          title: newTitle,
        });
      }
    },

    async editSubProjectTitle() {
      const newTitle = prompt("修改子專案名稱:", this.currentSubProject.title);
      if (
        newTitle &&
        newTitle.trim() !== "" &&
        newTitle !== this.currentSubProject.title
      ) {
        this.currentSubProject.title = newTitle;
        await updateDoc(doc(db, "sub_projects", this.currentSubProject.id), {
          title: newTitle,
        });
      }
    },

    addSetupMilestone() {
      this.setupForm.milestones.push({
        id: "ms" + Date.now(),
        date: "",
        title: "",
        isCompleted: false,
      });
    },
    async confirmSetup() {
      if (this.currentSubProject.assignee !== this.currentUser.name)
        return alert("權限不足：只有專案負責人才能進行規劃設定");
      if (!this.setupForm.startDate) return alert("請設定專案開始日期");
      if (this.setupForm.milestones.length === 0)
        return alert("請至少建立一個里程碑節點");
      this.setupForm.milestones.sort(
        (a, b) => new Date(a.date) - new Date(b.date)
      );
      this.setupForm.endDate =
        this.setupForm.milestones[this.setupForm.milestones.length - 1].date;
      if (this.setupForm.startDate < this.currentParentProject.startDate)
        return alert(
          `子專案開始日不能早於母專案 (${this.currentParentProject.startDate})`
        );
      this.isSubmitting = true;
      try {
        await updateDoc(doc(db, "sub_projects", this.currentSubProject.id), {
          ...this.setupForm,
          status: "in_progress",
        });
        Object.assign(this.currentSubProject, {
          ...this.setupForm,
          status: "in_progress",
        });
        this.setupForm = { startDate: "", endDate: "", milestones: [] };
      } catch (e) {
        console.error(e);
        alert("更新失敗");
      } finally {
        this.isSubmitting = false;
      }
    },
    async addResourceLink() {
      const title = prompt("連結名稱:");
      if (!title) return;
      const url = prompt("網址 (URL):");
      if (!url) return;
      const newLinkObj = { title, url };
      if (!this.currentSubProject.links) this.currentSubProject.links = [];
      const links = [...this.currentSubProject.links, newLinkObj];
      await updateDoc(doc(db, "sub_projects", this.currentSubProject.id), {
        links,
      });
      this.currentSubProject.links = links;
    },
    async addComment() {
      if (!this.newComment.trim()) return;
      const content = this.newComment;
      const newCommentObj = {
        id: "c" + Date.now(),
        user: this.currentUser.name,
        content: content,
        time: new Date().toLocaleString(),
      };
      if (!this.currentSubProject.comments)
        this.currentSubProject.comments = [];
      this.currentSubProject.comments.push(newCommentObj);
      this.newComment = "";
      this.showMentionList = false;
      try {
        await updateDoc(doc(db, "sub_projects", this.currentSubProject.id), {
          comments: this.currentSubProject.comments,
        });
        const matches = [...content.matchAll(/@(\S+)/g)];
        const uniqueNames = [...new Set(matches.map((m) => m[1]))];
        uniqueNames.forEach(async (name) => {
          const targetUser = this.users.find((u) => u.name === name);
          if (targetUser && targetUser.name !== this.currentUser.name) {
            await this.sendNotification(
              targetUser.name,
              "task",
              `${this.currentUser.name} 在留言中提及了您: ${content}`,
              this.currentParentProject.id,
              this.currentSubProject.id
            );
          }
        });
      } catch (e) {
        console.error("Comment Error", e);
      }
    },
    checkForMention() {
      this.showMentionList = this.newComment.endsWith("@");
    },
    selectMention(name) {
      this.newComment += name + " ";
      this.showMentionList = false;
      this.$nextTick(() => {
        const input = this.$el.querySelector('input[placeholder*="留言"]');
        if (input) input.focus();
      });
    },
    changeMonth(delta) {
      this.calendarMonth += delta;
      if (this.calendarMonth > 12) {
        this.calendarMonth = 1;
        this.calendarYear++;
      } else if (this.calendarMonth < 1) {
        this.calendarMonth = 12;
        this.calendarYear--;
      }
    },
    openEventModal() {
      if (this.currentSubProject.currentHandler !== this.currentUser.name)
        return alert("只有目前負責人 (球在手上) 才能新增工作日誌");
      this.eventForm = {
        date: new Date().toISOString().split("T")[0],
        hours: 0,
        worker: this.currentUser.name,
        nextAssignee:
          this.currentSubProject.currentHandler ||
          this.currentSubProject.assignee,
        description: "",
        matchedMilestoneId: "",
      };
      this.showEventModal = true;
    },
    async saveEvent() {
      // 1. 權限檢查
      if (this.currentSubProject.currentHandler !== this.currentUser.name)
        return;

      // 2. 日期檢查：不可早於專案開始日
      if (
        new Date(this.eventForm.date) <
        new Date(this.currentSubProject.startDate)
      ) {
        alert(
          `工作日誌日期 (${this.eventForm.date}) 不可早於子專案開始日 (${this.currentSubProject.startDate})`
        );
        return;
      }

      // 3. 日期檢查：不可早於上一筆日誌 (保持時間軸連貫)
      if (
        this.currentSubProject.events &&
        this.currentSubProject.events.length > 0
      ) {
        const lastEventDate = this.currentSubProject.events.reduce(
          (latest, ev) => {
            return new Date(ev.date) > new Date(latest) ? ev.date : latest;
          },
          this.currentSubProject.events[0].date
        );
        if (new Date(this.eventForm.date) < new Date(lastEventDate)) {
          alert(
            `工作日誌日期 (${this.eventForm.date}) 不得早於最後一筆記錄日期 (${lastEventDate})`
          );
          return;
        }
      }

      // 4. [防呆] 若為最後一個里程碑節點，禁止將球權轉給別人
      if (this.eventForm.matchedMilestoneId) {
        const sortedMilestones = [...this.currentSubProject.milestones].sort(
          (a, b) => new Date(a.date) - new Date(b.date)
        );
        const lastMilestone = sortedMilestones[sortedMilestones.length - 1];
        if (this.eventForm.matchedMilestoneId === lastMilestone.id) {
          if (this.eventForm.nextAssignee !== this.currentUser.name) {
            return alert(
              "此為最後一個里程碑節點，專案即將結束，無法將球權移轉給他人。請將「後續處理人員」設為自己，並直接觸發結案流程。"
            );
          }
        }
      }

      // 5. 建立新日誌物件
      const newEvent = {
        id: "ev" + Date.now(),
        ...this.eventForm,
        handoffTo:
          this.eventForm.nextAssignee !== this.currentUser.name
            ? this.eventForm.nextAssignee
            : null,
      };

      const nextHandler = this.eventForm.nextAssignee;
      const isHandoff = nextHandler !== this.currentUser.name;
      let isProjectCompleted = false;
      let delayDetected = false;

      // 6. 將日誌推入本地陣列
      if (!this.currentSubProject.events) this.currentSubProject.events = [];
      this.currentSubProject.events.push(newEvent);

      const oldHandler = this.currentSubProject.currentHandler;
      this.currentSubProject.currentHandler = nextHandler;

      // ==========================================
      // [優化關鍵] 計算總工時並寫入 (新增部分)
      // ==========================================
      const newTotalHours = this.currentSubProject.events.reduce(
        (sum, ev) => sum + Number(ev.hours || 0),
        0
      );
      // 強制進位到小數點第一位
      const roundedTotal = Math.round(newTotalHours * 10) / 10;
      // 更新本地資料 (讓畫面立刻變)
      this.currentSubProject.totalHours = roundedTotal;
      // ==========================================

      // 7. 里程碑匹配與結案邏輯判斷
      if (this.eventForm.matchedMilestoneId) {
        const sortedMilestones = [...this.currentSubProject.milestones].sort(
          (a, b) => new Date(a.date) - new Date(b.date)
        );
        const lastMilestone = sortedMilestones[sortedMilestones.length - 1];
        const ms = this.currentSubProject.milestones.find(
          (m) => m.id === this.eventForm.matchedMilestoneId
        );
        if (ms) {
          ms.isCompleted = true;
          ms.completedDate = this.eventForm.date;
          ms.diffDays = Math.floor(
            (new Date(this.eventForm.date) - new Date(ms.date)) / 86400000
          );

          // 如果是最後一個節點 -> 觸發結案檢查
          if (ms.id === lastMilestone.id) {
            const today = new Date(this.eventForm.date);
            const deadline = new Date(this.currentSubProject.endDate);
            const finalDelay = Math.floor((today - deadline) / 86400000);

            if (finalDelay > 0) {
              // A. 發生延遲：彈出視窗詢問原因 (不直接存檔)
              delayDetected = true;
              // 回滾狀態 (因為要等填完原因才算數)
              this.currentSubProject.events.pop();
              this.currentSubProject.currentHandler = oldHandler;
              ms.isCompleted = false;

              // 暫存資料傳給 Modal
              this.tempCompletionData = {
                finalDelay,
                newEvent,
                milestoneId: ms.id,
                nextHandler,
              };

              this.showEventModal = false;
              this.modalMode = "sub_delay_complete";
              this.delayForm = { reason: "人力不足", remark: "" };
              this.showDelayReasonModal = true;
              return; // ★ 這裡直接 Return，等待 Modal 確認後再存檔
            } else {
              // B. 準時完成：直接結案
              isProjectCompleted = true;
              this.currentSubProject.status = "archived"; // 您的邏輯是設為 archived (或 completed)
              this.currentSubProject.finalDelayDays = 0;
              this.currentSubProject.completedDate = this.eventForm.date;
              // alert("恭喜！專案準時完成，自動結案。");
              this.triggerConfetti();
            }
          }
        }
      }

      this.showEventModal = false;

      // 8. 寫入資料庫 (Firestore Update)
      try {
        const updates = {
          events: this.currentSubProject.events,
          currentHandler: nextHandler,
          milestones: this.currentSubProject.milestones,

          // [優化關鍵] 將算好的總工時存入資料庫
          totalHours: roundedTotal,
        };

        if (isHandoff) {
          updates.lastHandoffDate = this.eventForm.date;
          this.sendNotification(
            nextHandler,
            "handoff",
            `收到工作交接: ${this.currentSubProject.title}`,
            this.currentParentProject.id,
            this.currentSubProject.id
          );
        }

        if (isProjectCompleted) {
          updates.status = "completed"; // 或 archived，視您原本邏輯而定
          updates.finalDelayDays = 0;
          updates.completedDate = this.eventForm.date;
        }

        await updateDoc(
          doc(db, "sub_projects", this.currentSubProject.id),
          updates
        );

        // [補丁] 如果結案了，手動把它加到歷史陣列，避免它從畫面消失
        if (isProjectCompleted) {
          const completedProject = { ...this.currentSubProject, ...updates };
          this.historySubs.push(completedProject);
          this.buildIndexes();
        }
      } catch (e) {
        console.error("Sync Failed", e);
        alert("存檔失敗，請檢查網路");
      }
    },

    // [UX 彩蛋] 隨機結案慶祝特效
    triggerConfetti() {
      // 1. 播放音效
      const audio = document.getElementById("notification-sound");
      if (audio) {
        audio.currentTime = 0;
        audio.play().catch((e) => console.log("Audio play blocked", e));
      }

      // 2. 隨機決定特效模式 (0, 1, 2)
      const mode = Math.floor(Math.random() * 3);

      if (mode === 0) {
        // Mode 0: 兩側加農砲 (經典品牌色)
        const end = Date.now() + 2000;
        const colors = ["#4f46e5", "#fabe00", "#ef4444"];
        (function frame() {
          confetti({
            particleCount: 2,
            angle: 60,
            spread: 55,
            origin: { x: 0 },
            colors: colors,
          });
          confetti({
            particleCount: 2,
            angle: 120,
            spread: 55,
            origin: { x: 1 },
            colors: colors,
          });
          if (Date.now() < end) requestAnimationFrame(frame);
        })();
        console.log("🎉 Effect: Side Cannons");
      } else if (mode === 1) {
        // Mode 1: 盛大煙火秀 (隨機炸裂)
        const duration = 3000;
        const animationEnd = Date.now() + duration;
        const defaults = {
          startVelocity: 30,
          spread: 360,
          ticks: 60,
          zIndex: 9999,
        };
        const randomInRange = (min, max) => Math.random() * (max - min) + min;

        const interval = setInterval(function () {
          const timeLeft = animationEnd - Date.now();
          if (timeLeft <= 0) return clearInterval(interval);
          const particleCount = 50 * (timeLeft / duration);
          confetti(
            Object.assign({}, defaults, {
              particleCount,
              origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 },
            })
          );
          confetti(
            Object.assign({}, defaults, {
              particleCount,
              origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 },
            })
          );
        }, 250);
        console.log("🎉 Effect: Fireworks");
      } else {
        // Mode 2: 紙醉金迷 (金色豪華版)
        const count = 200;
        const defaults = { origin: { y: 0.7 } };
        const goldColors = ["#FFD700", "#F0E68C", "#DAA520"]; // 金色系

        const fire = (particleRatio, opts) => {
          confetti(
            Object.assign({}, defaults, opts, {
              particleCount: Math.floor(count * particleRatio),
              colors: goldColors,
            })
          );
        };
        fire(0.25, { spread: 26, startVelocity: 55 });
        fire(0.2, { spread: 60 });
        fire(0.35, { spread: 100, decay: 0.91, scalar: 0.8 });
        fire(0.1, { spread: 120, startVelocity: 25, decay: 0.92, scalar: 1.2 });
        fire(0.1, { spread: 120, startVelocity: 45 });
        console.log("🎉 Effect: Luxury Gold");
      }
    },

    async sendNotification(recipient, type, message, pid, sid) {
      await addDoc(collection(db, "notifications"), {
        recipient,
        type,
        message,
        projectId: pid,
        subProjectId: sid,
        read: false,
        time: new Date().toLocaleString(),
        sender: this.currentUser.name,
      });
    },
    async handleNotificationClick(n) {
      const notifRef = doc(db, "notifications", n.id);
      await updateDoc(notifRef, { read: true });
      const parent = this.indexedParentMap[n.projectId];
      if (parent) {
        const subs = this.indexedSubsByParent[n.projectId] || [];
        const sub = subs.find((s) => s.id === n.subProjectId);
        if (sub) this.selectSubProject(sub, parent);
      }
      this.showNotifications = false;
    },
    async clearAllNotifications() {
      this.notifications.forEach(async (n) => {
        await deleteDoc(doc(db, "notifications", n.id));
      });
      this.notifications = [];
    },
    addToHistory() {
      this.historyStack.push({
        view: this.currentView,
        parentId: this.currentParentProject?.id,
        subId: this.currentSubProject?.id,
      });
    },
    goBack() {
      // [修改] 使用瀏覽器的上一頁功能
      this.$router.back();

      // 原本的 historyStack 邏輯可以全部刪除，因為 Vue Router 已經幫您管理歷史紀錄了！
    },
    selectParentProject(proj) {
      // [修改] 改用路由跳轉
      this.$router.push({ name: "parent", params: { pid: proj.id } });

      // 下面這幾行可以拿掉了，因為 handleRouteUpdate 會幫您做
      // this.addToHistory();
      // this.currentParentProject = proj;
      // this.currentView = "parent_detail";
    },

    // [New] 同步專注清單到 Firebase (重要：讓今日專注能被儲存)
    async syncFocusIdsToFirebase() {
      if (!this.currentUserId) return;
      try {
        await updateDoc(doc(db, "users", this.currentUserId), {
          focusIds: this.localFocusIds,
        });
      } catch (e) {
        console.error("同步失敗", e);
      }
    },

    // [New] 看板拖曳事件處理 (核心邏輯)
    async onKanbanChange(evt, targetColumn) {
      // VueDraggable 的 change 事件包含 added, removed, moved
      // 我們只關心 "added" (代表有東西被拖進這個欄位)
      if (evt.added) {
        const item = evt.added.element;

        // 取得來源欄位 (簡單判斷)
        let fromColumn = "backlog";
        if (item.status === "setup") fromColumn = "inbox";
        else if (item.isWaitingForManager) fromColumn = "review";
        else if (this.localFocusIds.includes(item.id)) fromColumn = "today";

        console.log(`從 ${fromColumn} 拖到 ${targetColumn}`, item.title);

        // ==========================================
        //  情境 1: 拖進 [🔥 今日專注]
        // ==========================================
        if (targetColumn === "today") {
          // 1. 加入 ID 到清單
          if (!this.localFocusIds.includes(item.id)) {
            this.localFocusIds.push(item.id);
            this.syncFocusIdsToFirebase(); // 存到雲端
          }

          // 2. 如果是從 [待規劃] 來的，要自動開案
          if (item.status === "setup") {
            this.currentSubProject = item;
            this.currentParentProject = item.parentObj;

            // 自動轉為執行中
            item.status = "in_progress";
            await updateDoc(doc(db, "sub_projects", item.id), {
              status: "in_progress",
            });

            // 如果您想要強制跳出模板視窗，可以在這裡呼叫 openSetupModal 之類的
            // alert(`已將「${item.title}」加入今日專注並設為執行中`);
          }

          // 3. 如果是從 [等待審核] 拉回來，解除等待狀態
          if (item.isWaitingForManager) {
            this.currentSubProject = item;
            await this.finishManagerCheck();
          }
        }

        // ==========================================
        //  情境 2: 拖進 [🔵 待辦清單] (移出今日專注)
        // ==========================================
        else if (targetColumn === "backlog") {
          // 1. 從專注清單移除
          const idx = this.localFocusIds.indexOf(item.id);
          if (idx > -1) {
            this.localFocusIds.splice(idx, 1);
            this.syncFocusIdsToFirebase();
          }

          // 2. Setup -> Backlog (開工但不急)
          if (item.status === "setup") {
            item.status = "in_progress";
            await updateDoc(doc(db, "sub_projects", item.id), {
              status: "in_progress",
            });
          }

          // 3. Review -> Backlog (審核完回來)
          if (item.isWaitingForManager) {
            this.currentSubProject = item;
            await this.finishManagerCheck();
          }
        }

        // ==========================================
        //  情境 3: 拖進 [⏳ 等待審核]
        // ==========================================
        else if (targetColumn === "review") {
          // 1. 從專注清單移除 (因為卡住了，不用專注了)
          const idx = this.localFocusIds.indexOf(item.id);
          if (idx > -1) {
            this.localFocusIds.splice(idx, 1);
            this.syncFocusIdsToFirebase();
          }

          // 2. 觸發審核流程
          this.currentSubProject = item;
          await this.startManagerCheck();
        }
      }
    },
    pokeHeader() {
            this.pokeCount++;
            this.isHeaderSpinning = true;

            // 讓 icon 轉一圈，0.5秒後停下來
            setTimeout(() => {
                this.isHeaderSpinning = false;
            }, 500);

            // 如果連續戳了 5 下
            if (this.pokeCount >= 5) {
                const originalTitle = "我的待辦任務";
                // 變身！
                this.headerTitle = "別戳了！快去工作！💢";
                
                // 3秒後氣消
                setTimeout(() => {
                    this.headerTitle = originalTitle;
                    this.pokeCount = 0; // 重置計數
                }, 3000);
            }
        },

        // 👇👇👇 [請補上這一段] 超級煙火函式 (Konami Code 用) 👇👇👇
        triggerSuperParty() {
            if (!window.confetti) return;
            console.log("Konami Code Activated! 🚀");

            const duration = 3000;
            const end = Date.now() + duration;

            (function frame() {
                confetti({
                    particleCount: 5,
                    angle: 60,
                    spread: 55,
                    origin: { x: 0 }
                });
                confetti({
                    particleCount: 5,
                    angle: 120,
                    spread: 55,
                    origin: { x: 1 }
                });

                if (Date.now() < end) {
                    requestAnimationFrame(frame);
                }
            }());
        },

    selectSubProject(sp, parent) {
      // [修改] 改用路由跳轉
      this.$router.push({
        name: "sub",
        params: { pid: parent.id, sid: sp.id },
      });

      // 下面這幾行可以拿掉了
      // this.addToHistory();
      // this.currentParentProject = parent;
      // this.currentSubProject = sp;
      // this.currentView = "sub_project_detail";
    },
    // [修正] 請補上這兩個函式到 methods 裡，不然 HTML 會報錯

    // 1. 取得卡片要顯示的目標日期 (最近里程碑 > 結束日)
    getTaskTargetDate(item) {
      // 如果有里程碑，嘗試找最近的未完成里程碑
      if (item.milestones && item.milestones.length > 0) {
        // 找出「未完成」且「有日期」的里程碑，並依照日期排序 (最早的在前)
        const nextMs = item.milestones
          .filter((m) => !m.isCompleted && m.date)
          .sort((a, b) => new Date(a.date) - new Date(b.date))[0];

        if (nextMs) return nextMs.date;
      }
      // 2. 如果沒有里程碑 (或都做完了)，就顯示原本的結案日
      return item.endDate;
    },

    // 2. 取得該日期的名稱 (例如：腳本確認)
    getTaskTargetLabel(item) {
      if (item.milestones && item.milestones.length > 0) {
        const nextMs = item.milestones
          .filter((m) => !m.isCompleted && m.date)
          .sort((a, b) => new Date(a.date) - new Date(b.date))[0];

        if (nextMs) return nextMs.title;
      }
      return "專案結束";
    },
    // [修正] 看板日期顏色：直接判斷「顯示日期」的急迫性
    getKanbanDateClass(item) {
      // 1. 取得目前卡片顯示的日期 (可能是節點，也可能是結案日)
      const targetDateStr = this.getTaskTargetDate(item);
      if (!targetDateStr) return "text-slate-400";

      const now = new Date();
      const todayStr = now.toISOString().split("T")[0];

      // 計算三天後的日期 (用來判斷橘燈)
      const lagDate = new Date();
      lagDate.setDate(lagDate.getDate() + 3);
      const lagDateStr = lagDate.toISOString().split("T")[0];

      // 2. 判斷邏輯
      // A. 已經過期 (紅字 + 閃爍動畫)
      if (targetDateStr < todayStr) {
        return "text-red-600 animate-pulse";
      }
      // B. 三天內要到期 (亮橘色)
      if (targetDateStr <= lagDateStr) {
        return "text-orange-500";
      }
      // C. 還很久 (灰色)
      return "text-slate-400";
    },

    // [New] 計算專案里程碑完成度 (回傳 0~100 的數字)
    getProjectProgress(item) {
      // 如果沒有設定里程碑，進度就是 0
      if (!item.milestones || item.milestones.length === 0) return 0;

      // 計算已完成的數量
      const completed = item.milestones.filter((m) => m.isCompleted).length;

      // 回傳百分比 (四雪五入)
      return Math.round((completed / item.milestones.length) * 100);
    },

    openCalendarSideEvent(ev) {
      this.calendarSideEvent = ev;
    },
    openParentAbortModal() {
      this.modalMode = "parent_abort";
      this.delayForm = { reason: "策略調整", remark: "" };
      this.showDelayReasonModal = true;
    },
    openSubAbortModal() {
      this.modalMode = "sub_abort";
      this.delayForm = { reason: "策略調整", remark: "" };
      this.showDelayReasonModal = true;
    },
    async submitDelayModal() {
      this.isSubmitting = true;
      try {
        if (this.modalMode === "sub_delay_complete") {
          const data = this.tempCompletionData;
          if (!data) throw new Error("暫存資料遺失，請重新操作");
          const ms = this.currentSubProject.milestones.find(
            (m) => m.id === data.milestoneId
          );
          if (!this.currentSubProject.events)
            this.currentSubProject.events = [];
          this.currentSubProject.events.push(data.newEvent);
          this.currentSubProject.currentHandler = data.nextHandler;
          if (ms) {
            ms.isCompleted = true;
            ms.completedDate = data.newEvent.date;
            ms.diffDays = Math.floor(
              (new Date(data.newEvent.date) - new Date(ms.date)) / 86400000
            );
          }
          this.currentSubProject.status = "archived";
          this.currentSubProject.finalDelayDays = data.finalDelay;
          this.currentSubProject.delayReason = this.delayForm.reason;
          this.currentSubProject.delayRemark = this.delayForm.remark;
          this.currentSubProject.completedDate = data.newEvent.date;
          await updateDoc(doc(db, "sub_projects", this.currentSubProject.id), {
            events: this.currentSubProject.events,
            currentHandler: data.nextHandler,
            milestones: this.currentSubProject.milestones,
            status: "completed",
            finalDelayDays: data.finalDelay,
            delayReason: this.delayForm.reason,
            delayRemark: this.delayForm.remark || "",
            completedDate: data.newEvent.date,
          });
        } else if (this.modalMode === "parent_abort") {
          if (confirm("確定中止此母專案？")) {
            await updateDoc(doc(db, "projects", this.currentParentProject.id), {
              status: "aborted",
              delayReason: this.delayForm.reason,
              delayRemark: this.delayForm.remark || "",
            });
            this.currentView = "dashboard";
          }
        } else if (this.modalMode === "sub_abort") {
          await updateDoc(doc(db, "sub_projects", this.currentSubProject.id), {
            status: "aborted",
            delayReason: this.delayForm.reason,
            delayRemark: this.delayForm.remark || "",
          });
          this.currentSubProject.status = "aborted";
        }
        if (
          ["completed", "archived", "aborted"].includes(
            this.currentSubProject.status
          )
        ) {
          // 確保物件已經是最新的狀態
          this.historySubs.push({ ...this.currentSubProject });
          this.buildIndexes();

          // [新增] 如果是結案 (completed/archived) 且不是中止 (aborted)，就放彩帶
          if (this.currentSubProject.status !== "aborted") {
            this.triggerConfetti();
          }
        }

        // alert("資料已儲存"); <--- 建議把這個拿掉，因為彩帶本身就是最好的回饋
        this.showDelayReasonModal = false;
        this.delayForm = { reason: "人力不足", remark: "" };
      } catch (e) {
        console.error(e);
        alert("儲存失敗，請檢查網路或重試：" + e.message);
      } finally {
        this.isSubmitting = false;
      }
    },
    // [New] 全案歸檔按鈕動作
    async archiveProject(project) {
      if (!confirm(`確定要將專案「${project.title}」歸檔嗎？`)) return;

      try {
        await updateDoc(doc(db, "projects", project.id), {
          status: "archived",
        });
        project.status = "archived"; // Local update
        this.currentView = "dashboard";
        this.loadHistoryData();
        alert("專案已歸檔！");
      } catch (e) {
        console.error(e);
        alert("歸檔失敗");
      }
    },
    // 結案 (與歸檔不同，結案為 completed)
    async completeParentProject(proj) {
      if (confirm("確認全案結案？(狀態將變為 completed)"))
        await updateDoc(doc(db, "projects", proj.id), { status: "completed" });
      this.currentView = "dashboard";
    },
    exportHistoryReport() {
      const rows = [
        [
          "品牌",
          "母專案",
          "子專案",
          "負責人",
          "結案日期",
          "總工時",
          "最終狀態",
          "延遲天數",
          "延遲原因",
        ],
        ...this.scopedStats.archivedList.map((i) => [
          i.brand.name,
          i.parent.title,
          i.branch.title,
          i.branch.assignee,
          i.branch.endDate,
          i.branch.actHours || 0,
          i.branch.status,
          i.branch.finalDelayDays || 0,
          i.branch.delayReason || "",
        ]),
      ];
      let csvContent =
        "data:text/csv;charset=utf-8,\uFEFF" +
        rows.map((e) => e.join(",")).join("\n");
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", `mkgt_history_report.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    },
    toggleExpand(p) {
      p.expanded = !p.expanded;
    },
    // [修正] 底層計算函式：強制進位到小數點第一位
    calcSubProjectHours(sp) {
      // [優化] 如果資料庫裡已經有算好的欄位，直接回傳 (CPU 複雜度從 O(N) 降為 O(1))
      if (sp.totalHours !== undefined) {
        return sp.totalHours;
      }

      // [相容性] 萬一遇到漏網之魚(舊資料)，還是用舊方法算一下，避免顯示 0
      const total = (sp.events || []).reduce(
        (sum, ev) => sum + Number(ev.hours || 0),
        0
      );
      return Math.round(total * 10) / 10;
    },
    getMilestoneName(mid) {
      return (
        this.currentSubProject?.milestones?.find((m) => m.id === mid)?.title ||
        "Unknown"
      );
    },
    isMilestoneOverdue(ms) {
      if (ms.isCompleted) return false;
      if (!ms.date) return false;
      return new Date(ms.date) < new Date().setHours(0, 0, 0, 0);
    },
    getDaysLate(d) {
      if (!d) return 0;
      return Math.ceil((new Date() - new Date(d)) / (1000 * 60 * 60 * 24));
    },
    getDaysHeld(input) {
      let dStr = input;
      if (typeof input === "object" && input !== null) {
        if (input.isWaitingForManager) return 0;
        dStr = input.lastHandoffDate;
      }
      if (!dStr) return 0;
      const start = new Date(dStr);
      const end = new Date();
      start.setHours(0, 0, 0, 0);
      end.setHours(0, 0, 0, 0);
      if (start >= end) return 0;
      let count = 0;
      let curr = new Date(start);
      while (curr < end) {
        curr.setDate(curr.getDate() + 1);
        const dayOfWeek = curr.getDay();
        if (dayOfWeek !== 0 && dayOfWeek !== 6) {
          count++;
        }
      }
      return count;
    },
    getSubProjectDelayDays(sp) {
      if (sp.status === "completed") return sp.finalDelayDays || 0;
      if (!sp.endDate) return 0;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const target = new Date(sp.endDate);
      target.setHours(0, 0, 0, 0);
      if (target < today && sp.status !== "aborted")
        return Math.floor((today - target) / 86400000);
      return 0;
    },
    getProjectHealth(sp) {
      if (sp.status === "completed") {
        if (sp.finalDelayDays > 0)
          return { type: "delay", days: sp.finalDelayDays };
        return { type: "normal", days: 0 };
      }
      if (sp.status === "aborted") return { type: "aborted", days: 0 };
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (!sp.endDate) return { type: "normal", days: 0 };
      const deadline = new Date(sp.endDate);
      deadline.setHours(0, 0, 0, 0);
      if (deadline < today) {
        return {
          type: "delay",
          days: Math.floor((today - deadline) / 86400000),
        };
      }
      if (sp.milestones && sp.milestones.length > 0) {
        const sorted = [...sp.milestones].sort(
          (a, b) => new Date(a.date) - new Date(b.date)
        );
        const uncompleted = sorted.filter((m) => !m.isCompleted);
        if (uncompleted.length > 0) {
          const nextMs = uncompleted[0];
          if (nextMs.id !== sorted[sorted.length - 1].id) {
            const msDate = new Date(nextMs.date);
            msDate.setHours(0, 0, 0, 0);
            if (msDate < today) {
              return {
                type: "lag",
                days: Math.floor((today - msDate) / 86400000),
              };
            }
          }
        }
      }
      return {
        type: "normal",
        days: Math.floor((deadline - today) / 86400000),
      };
    },
    statusBadge(s) {
      // [新增] 規劃中 (黃色 + 邊框)
      if (s === "setup")
        return "bg-yellow-100 text-yellow-700 border border-yellow-200";

      if (s === "completed") return "bg-emerald-100 text-emerald-700";
      if (s === "in_progress") return "bg-indigo-100 text-indigo-700";
      if (s === "aborted") return "bg-slate-200 text-slate-600";
      if (s === "archived") return "bg-gray-800 text-gray-300";

      return "bg-slate-100 text-slate-500"; // 預設值
    },
    getDeadlineStatus(dateStr) {
      if (!dateStr) return { status: "normal", label: "未定", days: 0 };
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const target = new Date(dateStr);
      target.setHours(0, 0, 0, 0);
      const diffTime = target - today;
      const diffDays = Math.floor(diffTime / 86400000);
      if (diffDays < 0)
        return {
          status: "overdue",
          label: `延遲 ${Math.abs(diffDays)} 天`,
          days: Math.abs(diffDays),
        };
      if (diffDays <= 7)
        return {
          status: "warning",
          label: `剩 ${diffDays} 天`,
          days: diffDays,
        };
      return { status: "normal", label: `剩 ${diffDays} 天`, days: diffDays };
    },
    getDateStyle(dateStr, status = "active") {
      // 1. 如果專案狀態是「已完成、已歸檔、已中止」，一律回傳一般顏色 (灰色/深色)
      if (["completed", "archived", "aborted"].includes(status)) {
        return "text-slate-500 font-medium";
      }

      // 2. 原本的邏輯 (只針對執行中 active / in_progress 的專案)
      const s = this.getDeadlineStatus(dateStr);
      if (s.status === "overdue") return "text-red-600 font-bold";
      if (s.status === "warning") return "text-yellow-600 font-bold";
      return "text-slate-500";
    },
    getBranchProgress(branch) {
      const total = branch.milestones?.length || 0;
      if (total === 0) return { percent: 0 };
      const done = branch.milestones.filter((m) => m.isCompleted).length;
      return { percent: Math.round((done / total) * 100) };
    },
    branchHasDelay(branch) {
      return this.getSubProjectDelayDays(branch) > 0;
    },

    // --- 主管確認邏輯 ---
    async startManagerCheck() {
      if (
        !confirm(
          "確定要提交線下確認嗎？\n(這將會在日誌中記錄時間點，並暫停計算您的滯留天數)"
        )
      )
        return;

      this.isSubmitting = true;
      try {
        const today = new Date().toISOString().split("T")[0];
        const logEvent = {
          id: "ev" + Date.now(),
          date: today,
          hours: 0,
          worker: this.currentUser.name,
          description: "🕒 [開始] 提交主管線下確認 (系統暫停計時)",
          handoffTo: null,
        };
        if (!this.currentSubProject.events) this.currentSubProject.events = [];
        this.currentSubProject.events.push(logEvent);
        await updateDoc(doc(db, "sub_projects", this.currentSubProject.id), {
          events: this.currentSubProject.events,
          isWaitingForManager: true,
          managerCheckStartDate: today,
        });
        this.currentSubProject.isWaitingForManager = true;
        this.currentSubProject.managerCheckStartDate = today;
      } catch (e) {
        console.error(e);
        alert("操作失敗");
      } finally {
        this.isSubmitting = false;
      }
    },

    async finishManagerCheck() {
      this.isSubmitting = true;
      try {
        const today = new Date().toISOString().split("T")[0];
        const startDate = this.currentSubProject.managerCheckStartDate || today;
        const diffTime = Math.abs(new Date(today) - new Date(startDate));
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        const durationText = diffDays === 0 ? "同日完成" : `${diffDays} 天`;
        const logEvent = {
          id: "ev" + Date.now(),
          date: today,
          hours: 0,
          worker: this.currentUser.name,
          description: `✅ [結束] 主管確認完成 (耗時: ${durationText})`,
          handoffTo: null,
        };
        if (!this.currentSubProject.events) this.currentSubProject.events = [];
        this.currentSubProject.events.push(logEvent);
        await updateDoc(doc(db, "sub_projects", this.currentSubProject.id), {
          events: this.currentSubProject.events,
          isWaitingForManager: false,
          managerCheckStartDate: null,
          lastHandoffDate: today,
        });
        this.currentSubProject.isWaitingForManager = false;
        this.currentSubProject.managerCheckStartDate = null;
        this.currentSubProject.lastHandoffDate = today;
        alert(`確認程序已記錄！共耗時：${durationText}`);
      } catch (e) {
        console.error(e);
        alert("操作失敗");
      } finally {
        this.isSubmitting = false;
      }
    },

    // --- 快速檢視視窗 ---
    openQuickView(branch, parent, brand) {
      // [修改] 增加 brand 參數
      this.quickViewData = { branch, parent, brand }; // [修改] 把 brand 存進去
      this.showQuickViewModal = true;
    },
    getQuickViewMilestones(branch) {
      if (!branch.milestones) return [];
      const sorted = [...branch.milestones].sort(
        (a, b) => new Date(a.date) - new Date(b.date)
      );
      const firstIncompleteIdx = sorted.findIndex((m) => !m.isCompleted);
      return sorted.map((m, idx) => ({
        ...m,
        isCurrent: firstIncompleteIdx !== -1 && idx === firstIncompleteIdx,
        isPast: m.isCompleted,
        isFuture:
          !m.isCompleted &&
          firstIncompleteIdx !== -1 &&
          idx > firstIncompleteIdx,
      }));
    },

    // [New] 計算特定里程碑的累計工時
    // 在 methods: { ... } 裡面

    // [修改] 計算特定里程碑的累計工時 (邏輯：計算 上一個節點 ~ 這個節點 之間的所有工時)
    getMilestoneHours(branch, milestoneId) {
      if (!branch || !branch.events || !branch.milestones) return 0;

      // 1. 先把里程碑依照日期排序，確保順序正確
      const sortedMs = [...branch.milestones].sort(
        (a, b) => new Date(a.date) - new Date(b.date)
      );

      // 2. 找到「目前這個節點」在陣列中的位置索引 (index)
      const currentIdx = sortedMs.findIndex((m) => m.id === milestoneId);
      if (currentIdx === -1) return 0; // 找不到此節點

      // 3. 定義時間區間 (Range)
      // 結束時間：當然就是「這個節點」的日期
      const currentEndDate = new Date(sortedMs[currentIdx].date);
      currentEndDate.setHours(23, 59, 59, 999); // 包含當天

      // 開始時間：要看有沒有「上一個節點」
      let prevEndDate;
      if (currentIdx === 0) {
        // 如果這是「第一個」節點，那開始時間就是無限早 (或是專案開始日)
        // 這裡設為 1970 年，確保所有在這個節點之前的工時都會被算進來
        prevEndDate = new Date("1970-01-01");
      } else {
        // 如果前面還有節點，開始時間就是「上一個節點」的日期
        prevEndDate = new Date(sortedMs[currentIdx - 1].date);
        prevEndDate.setHours(23, 59, 59, 999); // 設定為上個節點當天的最後一秒
      }

      // 4. 開始篩選並加總日誌
      const total = branch.events.reduce((sum, ev) => {
        const evDate = new Date(ev.date);

        // 核心邏輯：日誌日期 必須「大於」上個節點 且 「小於等於」這個節點
        // (也就是夾在兩個節點中間的工時)
        if (evDate > prevEndDate && evDate <= currentEndDate) {
          return sum + Number(ev.hours || 0);
        }
        return sum;
      }, 0);

      return Math.round(total * 10) / 10;
    },
    // ... 其他 methods ...

    // [New] 開始調整側邊欄寬度
    startResizeSidebar(e) {
      this.isResizingSidebar = true;
      // 加入全域監聽，避免滑鼠移出 iframe 或區塊時失效
      document.addEventListener("mousemove", this.handleSidebarResize);
      document.addEventListener("mouseup", this.stopResizeSidebar);
      // 防止拖曳時選取到文字
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";
    },

    // [New] 計算新寬度
    handleSidebarResize(e) {
      if (!this.isResizingSidebar) return;

      // 設定最小與最大寬度限制
      const minWidth = 200;
      const maxWidth = 600;

      let newWidth = e.clientX;

      if (newWidth < minWidth) newWidth = minWidth;
      if (newWidth > maxWidth) newWidth = maxWidth;

      this.sidebarWidth = newWidth;
    },

    // [New] 停止調整
    stopResizeSidebar() {
      this.isResizingSidebar = false;
      document.removeEventListener("mousemove", this.handleSidebarResize);
      document.removeEventListener("mouseup", this.stopResizeSidebar);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    },
    // 在 methods: { ... } 裡面加入

    // [Admin] 強制刪除母專案 (危險操作)
    async adminDeleteParent() {
      if (this.currentUser.role !== "admin") return;
      const confirmStr = prompt(
        `⚠️ 危險操作！\n這將會永久刪除母專案「${this.currentParentProject.title}」。\n\n(注意：其下的子專案會變成孤兒，建議先手動刪除子專案)\n\n請輸入 "DELETE" 確認刪除：`
      );
      if (confirmStr === "DELETE") {
        try {
          await deleteDoc(doc(db, "projects", this.currentParentProject.id));
          alert("母專案已刪除");
          this.currentView = "dashboard";
        } catch (e) {
          console.error(e);
          alert("刪除失敗");
        }
      }
    },

    // [Admin] 強制刪除子專案
    async adminDeleteSub() {
      if (this.currentUser.role !== "admin") return;
      if (
        !confirm(
          `確定要永久刪除子專案「${this.currentSubProject.title}」嗎？此動作無法復原。`
        )
      )
        return;

      try {
        await deleteDoc(doc(db, "sub_projects", this.currentSubProject.id));
        alert("子專案已刪除");
        // 回到母專案
        this.currentView = "parent_detail";
      } catch (e) {
        console.error(e);
        alert("刪除失敗");
      }
    },

    // [Admin] 搬移子專案 (換爸爸)
    async adminMoveSubProject() {
      if (this.currentUser.role !== "admin") return;

      // 為了方便，先列出所有母專案讓管理者看 ID (或是您之後可以做成選單)
      console.log("可用母專案清單:", this.rawParents);

      const newParentId = prompt(
        "請輸入目標母專案的 ID (請按 F12 看 Console 或從網址列複製 ID):"
      );
      if (!newParentId) return;

      // 檢查 ID 是否存在
      const targetParent = this.indexedParentMap[newParentId];
      if (!targetParent) return alert("找不到該 ID 的母專案！");

      if (
        !confirm(
          `確定要將「${this.currentSubProject.title}」移動到「${targetParent.title}」底下嗎？`
        )
      )
        return;

      try {
        await updateDoc(doc(db, "sub_projects", this.currentSubProject.id), {
          parentId: newParentId,
        });
        alert("搬移成功！");
        this.currentView = "dashboard"; // 強制重整畫面邏輯
      } catch (e) {
        console.error(e);
        alert("搬移失敗");
      }
    },
    // 在 methods: { ... } 裡面加入：

    // [Admin] 更新母專案日期
    async updateParentDates() {
      // 權限檢查：只有 admin 可以改
      if (this.currentUser.role !== "admin") return;

      try {
        await updateDoc(doc(db, "projects", this.currentParentProject.id), {
          startDate: this.currentParentProject.startDate,
          endDate: this.currentParentProject.endDate,
        });

        // 這裡可以選擇是否要跳 alert，或是默默更新即可
        // alert("專案週期已更新");
        console.log("母專案日期已更新");
      } catch (e) {
        console.error("更新日期失敗", e);
        alert("更新失敗，請檢查權限或網路");
      }
    },
    async updateMilestone() {
      // 1. 權限檢查
      if (this.currentUser.role !== "admin") return;

      try {
        // 2. 直接把目前的 milestones 陣列存回去
        await updateDoc(doc(db, "sub_projects", this.currentSubProject.id), {
          milestones: this.currentSubProject.milestones,
        });
        // 選用：如果要安靜更新就不跳 alert
        // alert("節點資訊已更新");
        console.log("節點已更新");
      } catch (e) {
        console.error(e);
        alert("更新失敗");
      }
    },
    // 在 methods: { ... } 裡面加入：

    // [Admin] 新增里程碑節點
    async addMilestone() {
      if (this.currentUser.role !== "admin") return;

      const title = prompt("請輸入新節點名稱:");
      if (!title) return;
      const date = prompt(
        "請輸入預定日期 (YYYY-MM-DD):",
        new Date().toISOString().split("T")[0]
      );
      if (!date) return;

      const newMs = {
        id: "ms" + Date.now(), // 產生唯一 ID
        title: title,
        date: date,
        isCompleted: false,
      };

      try {
        // 確保陣列存在
        if (!this.currentSubProject.milestones)
          this.currentSubProject.milestones = [];

        this.currentSubProject.milestones.push(newMs);

        // 重新排序 (依日期)
        this.currentSubProject.milestones.sort(
          (a, b) => new Date(a.date) - new Date(b.date)
        );

        await updateDoc(doc(db, "sub_projects", this.currentSubProject.id), {
          milestones: this.currentSubProject.milestones,
        });
        alert("新節點已建立");
      } catch (e) {
        console.error(e);
        alert("新增失敗");
      }
    },

    // [Admin] 刪除里程碑節點 (帶防呆檢查)
    async deleteMilestone(msId) {
      if (this.currentUser.role !== "admin") return;

      // 1. 防呆檢查：是否有日誌關聯到此節點
      const hasLogs = (this.currentSubProject.events || []).some(
        (ev) => ev.matchedMilestoneId === msId
      );

      if (hasLogs) {
        alert(
          "❌ 無法刪除！\n\n已有「工作日誌」關聯到此節點。若強制刪除將導致工時統計錯誤。\n\n請先修改或刪除相關日誌，解除關聯後再試。"
        );
        return;
      }

      if (!confirm("確定要永久刪除此節點嗎？")) return;

      try {
        // 過濾掉該 ID
        this.currentSubProject.milestones =
          this.currentSubProject.milestones.filter((m) => m.id !== msId);

        await updateDoc(doc(db, "sub_projects", this.currentSubProject.id), {
          milestones: this.currentSubProject.milestones,
        });
        // alert("節點已刪除");
      } catch (e) {
        console.error(e);
        alert("刪除失敗");
      }
    },

    // [Admin] 更新里程碑 (修改日期或標題後觸發)
    async updateMilestone() {
      if (this.currentUser.role !== "admin") return;

      try {
        // 1. 重新計算所有已完成節點的「延遲天數 (diffDays)」
        //    公式：實際完成日 - 預定日期
        this.currentSubProject.milestones.forEach((m) => {
          if (m.isCompleted && m.completedDate && m.date) {
            const actual = new Date(m.completedDate);
            const plan = new Date(m.date);
            // 計算日差 (無條件捨去)
            m.diffDays = Math.floor((actual - plan) / (1000 * 60 * 60 * 24));
          }
        });

        // 2. 重新排序 (依預定日期)
        this.currentSubProject.milestones.sort(
          (a, b) => new Date(a.date) - new Date(b.date)
        );

        // 3. 存檔
        await updateDoc(doc(db, "sub_projects", this.currentSubProject.id), {
          milestones: this.currentSubProject.milestones,
        });
        console.log("節點更新成功 (已重算延遲天數)");
      } catch (e) {
        console.error(e);
        alert("更新存檔失敗");
      }
    },
    // [Admin] 修改工作日誌內容 (工時/內容)
    async updateEventLog() {
      if (this.currentUser.role !== "admin") return;

      try {
        // [優化] ★★★ 重新計算總工時 ★★★
        const newTotalHours = this.currentSubProject.events.reduce(
          (sum, ev) => sum + Number(ev.hours || 0),
          0
        );
        const roundedTotal = Math.round(newTotalHours * 10) / 10;
        this.currentSubProject.totalHours = roundedTotal; // 本地更新

        await updateDoc(doc(db, "sub_projects", this.currentSubProject.id), {
          events: this.currentSubProject.events,

          // [優化] ★★★ 寫入資料庫 ★★★
          totalHours: roundedTotal,
        });

        this.showToast("更新成功", "工時與日誌已修正", "success");
      } catch (e) {
        console.error(e);
        this.showToast("修正失敗", e.message, "error");
      }
    },

    navigateTo(pageName) {
      this.showMobileSidebar = false; // 關閉手機側邊欄

      // 透過 Router 去改變網址 -> 網址變了 -> 觸發上面的 handleRouteUpdate -> 畫面才會變
      if (pageName === "dashboard") this.$router.push("/");
      if (pageName === "report") this.$router.push("/report");
      if (pageName === "workspace") this.$router.push("/workspace");
    },
    // 在 methods: { ... } 裡面，請直接替換掉原本的 handleRouteUpdate

    // [最終修正版] 路由處理核心
    // [最終修正版] 路由處理核心 (含單筆補抓救援機制)
    async handleRouteUpdate(route) {
      // 1. 如果使用者權限還沒準備好，先不做事 (等待 watch: dataReady 觸發)
      if (!this.dataReady) return;

      console.log("路由同步畫面:", route.name, route.params);

      switch (route.name) {
        case "dashboard":
          this.currentView = "dashboard";
          this.selectedDashboardBrand = "all";
          break;

        case "report":
          this.currentView = "history_report";
          this.loadHistoryData();
          break;

        case "workspace":
          this.currentView = "my_workspace";
          this.workspaceTab = "tasks";
          break;

        case "parent": {
          const pid = route.params.pid;
          let parent = this.indexedParentMap[pid];

          // 救援 A: 嘗試下載歷史資料 (如果快取找不到)
          if (!parent && !this.isHistoryLoaded) {
            console.log("快取未命中，嘗試載入歷史資料...");
            await this.loadHistoryData();
            parent = this.indexedParentMap[pid];
          }

          // 救援 B: (終極) 如果還是找不到，直接單筆抓取
          // 這能解決「資料還沒下載完」或是「被 limit 擋住」的問題
          if (!parent) {
            console.log("啟動單筆救援：母專案", pid);
            try {
              const snap = await getDoc(doc(db, "projects", pid));
              if (snap.exists()) {
                parent = {
                  id: snap.id,
                  brandId: "",
                  title: "Untitled",
                  status: "active",
                  ...snap.data(),
                };
                // 補進 Map 避免下次還要抓
                this.indexedParentMap[pid] = parent;
                // 暫時塞進 activeParents 讓畫面能渲染
                this.activeParents.push(parent);
                // 重建索引確保關聯正確
                this.buildIndexes();
              }
            } catch (e) {
              console.error("母專案單筆補抓失敗", e);
            }
          }

          if (parent) {
            this.currentParentProject = parent;
            this.currentView = "parent_detail";
            this.detailTab = "overview";
          } else {
            console.warn("找不到母專案 ID:", pid);
            this.$router.replace("/");
          }
          break;
        }

        case "sub": {
          const subPid = route.params.pid;
          const sid = route.params.sid;

          let p = this.indexedParentMap[subPid];
          // 嘗試從活躍或歷史清單找子專案
          let s = this.activeSubs.find((sub) => sub.id === sid);
          if (!s) s = this.historySubs.find((sub) => sub.id === sid);

          // 救援 A: 下載歷史資料
          if ((!p || !s) && !this.isHistoryLoaded) {
            await this.loadHistoryData();
            // 重抓變數
            p = this.indexedParentMap[subPid];
            if (!s) s = this.activeSubs.find((sub) => sub.id === sid);
            if (!s) s = this.historySubs.find((sub) => sub.id === sid);
          }

          // 救援 B: (終極) 單筆抓取
          if (!p || !s) {
            console.log("快取未命中，啟動單筆救援 (子專案)...");
            try {
              // 1. 補抓母專案 (如果缺的話)
              if (!p) {
                const pSnap = await getDoc(doc(db, "projects", subPid));
                if (pSnap.exists()) {
                  p = {
                    id: pSnap.id,
                    brandId: "",
                    title: "Untitled",
                    status: "active",
                    ...pSnap.data(),
                  };
                  this.indexedParentMap[subPid] = p;
                  this.activeParents.push(p);
                }
              }
              // 2. 補抓子專案 (如果缺的話)
              if (!s) {
                const sSnap = await getDoc(doc(db, "sub_projects", sid));
                if (sSnap.exists()) {
                  const data = sSnap.data();
                  s = {
                    id: sSnap.id,
                    parentId: "",
                    title: "Untitled",
                    status: "setup",
                    ...data,
                    milestones: data.milestones || [],
                    events: data.events || [],
                    links: data.links || [],
                    comments: data.comments || [],
                  };
                  // 補進 activeSubs 讓畫面能顯示
                  this.activeSubs.push(s);
                  // 手動更新索引
                  if (!this.indexedSubsByParent[subPid])
                    this.indexedSubsByParent[subPid] = [];
                  this.indexedSubsByParent[subPid].push(s);
                }
              }
              // 補完資料後重建索引
              this.buildIndexes();
            } catch (e) {
              console.error("單筆補抓失敗", e);
            }
          }

          if (p && s) {
            this.currentParentProject = p;
            this.currentSubProject = s;
            this.detailTab = "events";
            this.currentView = "sub_project_detail";
          } else {
            console.warn("找不到子專案或母專案，導回首頁");
            this.$router.replace("/");
          }
          break;
        }

        default:
          if (this.currentView !== "dashboard") {
            this.currentView = "dashboard";
          }
          break;
      }
    },
    navigateTo(pageName) {
      this.showMobileSidebar = false; // 關閉手機側邊欄

      // 透過 Router 去改變網址 -> 網址變了 -> 觸發上面的 handleRouteUpdate -> 畫面才會變
      if (pageName === "dashboard") this.$router.push("/");
      if (pageName === "report") this.$router.push("/report");
      if (pageName === "workspace") this.$router.push("/workspace");
    },
    // [New] 應用模板 (自動計算日期)

    // [New] 應用模板 (支援不填開始日)
    applyTemplate() {
      if (this.selectedTemplateIndex === "") return;

      const template = this.projectTemplates[this.selectedTemplateIndex];
      const baseDateStr = this.setupForm.startDate;

      // 判斷基礎日期是否有效
      const hasBaseDate = baseDateStr && baseDateStr.trim() !== "";
      const baseDate = hasBaseDate ? new Date(baseDateStr) : null;

      template.milestones.forEach((tm) => {
        let dateStr = ""; // 預設為空白

        // 只有在「有基礎日期」且「模板有設定天數」時，才去計算
        if (hasBaseDate && tm.daysOffset !== undefined) {
          const targetDate = new Date(baseDate);
          targetDate.setDate(baseDate.getDate() + tm.daysOffset);
          dateStr = targetDate.toLocaleDateString("en-CA", {
            timeZone: "Asia/Taipei",
          });
        }

        this.setupForm.milestones.push({
          id: "ms" + Date.now() + Math.floor(Math.random() * 1000),
          title: tm.title,
          date: dateStr, // 沒得算就留白
          isCompleted: false,
        });
      });

      // 如果有日期，試著自動抓最後一天當結束日
      const validDates = this.setupForm.milestones.filter((m) => m.date !== "");
      if (validDates.length > 0) {
        validDates.sort((a, b) => new Date(a.date) - new Date(b.date));
        this.setupForm.endDate = validDates[validDates.length - 1].date;
      }

      alert(`模板「${template.name}」載入完成！`);
      this.selectedTemplateIndex = "";
    },
  },
  // [New] 同步專注清單到 Firebase
  async syncFocusIdsToFirebase() {
    if (!this.currentUserId) return;
    try {
      await updateDoc(doc(db, "users", this.currentUserId), {
        focusIds: this.localFocusIds,
      });
      // console.log("專注清單已同步雲端");
    } catch (e) {
      console.error("同步失敗", e);
    }
  },

  // [New] 看板拖曳事件處理 (核心)
  async onKanbanChange(evt, targetColumn) {
    // VueDraggable 的 change 事件包含 added, removed, moved
    if (evt.added) {
      const item = evt.added.element;
      const fromColumn = this.getDragSourceColumn(item); // 需要寫一個小 helper 找來源，或者直接從 item 狀態判斷

      console.log(`從 ${fromColumn} 拖到 ${targetColumn}`, item.title);

      // --- 1. 拖到 [今日專注] ---
      if (targetColumn === "today") {
        // 加入 ID 到清單
        if (!this.localFocusIds.includes(item.id)) {
          this.localFocusIds.push(item.id);
          this.syncFocusIdsToFirebase();
        }
        // 如果是從 [待規劃] 來的，要觸發模板
        if (item.status === "setup") {
          this.currentSubProject = item;
          this.currentParentProject = item.parentObj; // 確保有母專案參照
          // 這裡簡單處理：直接設為執行中 (您可以在這裡加入 openSetupModal 邏輯)
          item.status = "in_progress";
          await updateDoc(doc(db, "sub_projects", item.id), {
            status: "in_progress",
          });
          alert(`「${item.title}」已加入今日專注並開始執行！`);
        }
        // 如果是從 [等待審核] 拉回來，觸發解除等待
        if (item.isWaitingForManager) {
          this.currentSubProject = item;
          await this.finishManagerCheck();
        }
      }

      // --- 2. 拖到 [待辦清單] ---
      else if (targetColumn === "backlog") {
        // 從專注清單移除
        const idx = this.localFocusIds.indexOf(item.id);
        if (idx > -1) {
          this.localFocusIds.splice(idx, 1);
          this.syncFocusIdsToFirebase();
        }
        // Setup -> Backlog (開工但不急)
        if (item.status === "setup") {
          item.status = "in_progress";
          await updateDoc(doc(db, "sub_projects", item.id), {
            status: "in_progress",
          });
        }
        // Review -> Backlog (審核完回來)
        if (item.isWaitingForManager) {
          this.currentSubProject = item;
          await this.finishManagerCheck();
        }
      }

      // --- 3. 拖到 [等待審核] ---
      else if (targetColumn === "review") {
        // 從專注清單移除 (因為卡住了，不用專注了)
        const idx = this.localFocusIds.indexOf(item.id);
        if (idx > -1) {
          this.localFocusIds.splice(idx, 1);
          this.syncFocusIdsToFirebase();
        }

        this.currentSubProject = item;
        await this.startManagerCheck();
      }

      // --- 4. 拖到 [已完成] ---
      else if (targetColumn === "done") {
        // 從專注清單移除
        const idx = this.localFocusIds.indexOf(item.id);
        if (idx > -1) {
          this.localFocusIds.splice(idx, 1);
          this.syncFocusIdsToFirebase();
        }

        this.currentSubProject = item;
        // 觸發結案 (這會噴彩帶)
        // 這裡我們模擬填寫工作日誌為當天，並直接結案
        if (confirm(`確定要將「${item.title}」結案嗎？`)) {
          // 簡單結案邏輯，您也可以跳出 modal
          item.status = "completed";
          item.finalDelayDays = 0;
          item.completedDate = new Date().toISOString().split("T")[0];
          await updateDoc(doc(db, "sub_projects", item.id), {
            status: "completed",
            completedDate: item.completedDate,
            finalDelayDays: 0,
          });
          this.triggerConfetti();

          // 把他加到歷史陣列以免消失
          this.historySubs.push(item);
          this.buildIndexes();
        } else {
          // 如果取消，要重新整理畫面把卡片彈回去 (略)
          this.fetchDashboardData();
        }
        
      }
    }
  },

  // 輔助函式：判斷來源 (因為 VueDraggable 沒直接給 fromColumn)
  getDragSourceColumn(item) {
    if (item.status === "setup") return "inbox";
    if (item.isWaitingForManager) return "review";
    if (this.localFocusIds.includes(item.id)) return "today";
    return "backlog";
  },
  
});

app.use(router); // 掛載路由
app.component("vuedraggable", window.vuedraggable);
app.mount("#app");
