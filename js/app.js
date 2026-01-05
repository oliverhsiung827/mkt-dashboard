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
    delayReason: "",
    delayRemark: "",
    finalDelayDays: 0,
    createdAt: new Date().toISOString(),
  }),
};

const app = createApp({
  data() {
    return {
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
      roleMap: { director: "部主管", manager: "課主管", member: "職員" },
      statusMap: {
        setup: "規劃中",
        in_progress: "執行中",
        completed: "已結案",
        aborted: "已中止",
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
      isCommonLinksExpanded: true,
    };
  },
  async mounted() {
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
      return [...this.activeParents, ...this.historyParents];
    },
    rawSubs() {
      return [...this.activeSubs, ...this.historySubs];
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
    canEditSubProject() {
      if (!this.currentSubProject) return false;
      if (
        this.currentSubProject.status === "completed" ||
        this.currentSubProject.status === "aborted"
      )
        return false;
      if (this.currentUser.role !== "member") return true;
      return (
        this.currentSubProject.assignee === this.currentUser.name ||
        this.currentSubProject.currentHandler === this.currentUser.name
      );
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
    archivedProjects() {
      return this.rawParents.filter(
        (p) => p.status === "completed" || p.status === "aborted"
      );
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
    myHandledBranches() {
      const list = [];
      this.rawParents.forEach((p) => {
        const subs = this.indexedSubsByParent[p.id] || [];
        const brandName = this.indexedBrandMap[p.brandId] || "Unknown";
        subs.forEach((sp) => {
          if (
            sp.currentHandler === this.currentUser.name &&
            sp.status === "in_progress"
          ) {
            list.push({ brand: { name: brandName }, parent: p, sub: sp });
          }
        });
      });
      return list;
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
      const candidates = this.allSubProjects.filter(
        (i) => i.branch.status === "in_progress"
      );
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
      if (this.filterStatus === "all") return candidates;
      if (this.filterStatus === "delayed")
        return candidates.filter(
          (i) => this.getProjectHealth(i.branch).type === "delay"
        );
      return candidates;
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
        archivedHours: Math.round(totalPeriodHours * 10) / 10, // 進位到小數點第一位
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
        act += this.calcSubProjectHours(sp);
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
        act,
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
    memberStats() {
      return this.users.map((m) => {
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
    memberHoursStats() {
      const stats = {};
      this.users.forEach(
        (u) => (stats[u.name] = { name: u.name, team: u.team, hours: 0 })
      );
      this.allSubProjects.forEach((item) => {
        const sp = item.branch;
        if (sp.events) {
          sp.events.forEach((ev) => {
            if (this.checkDateMatch(ev.date) && stats[ev.worker])
              stats[ev.worker].hours += Number(ev.hours || 0);
          });
        }
      });
      return Object.values(stats).sort((a, b) => b.hours - a.hours);
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
          hours: hours,
          percent: totalAll ? Math.round((hours / totalAll) * 100) : 0,
        }))
        .sort((a, b) => b.hours - a.hours);
    },
  },
  watch: {
    // [效能優化] 觸發載入歷史資料
    currentView(newView) {
      if (newView === "history_report") {
        this.loadHistoryData();
      }
    },
    showArchived(isShown) {
      if (isShown) {
        this.loadHistoryData();
      }
    },
    memberDetailYear(newYear) {
      if (newYear !== "all" && newYear < new Date().getFullYear()) {
        this.loadHistoryData();
      }
    },
  },
  methods: {
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
        this.requestNotificationPermission();
        let loadCount = 0;
        const checkReady = () => {
          loadCount++;
          if (loadCount >= 4) {
            this.buildIndexes();
            this.dataReady = true;
            setTimeout(() => this.checkDailyTasks(), 2000);
          }
        };
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

        // 1. Users 與 Brands (全量)
        onSnapshot(collection(db, "users"), (s) => {
          this.users = s.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .sort((a, b) => (a.team || "").localeCompare(b.team || ""));
          checkReady();
        });
        onSnapshot(collection(db, "brands"), (s) => {
          this.brands = s.docs.map((d) => ({ id: d.id, ...d.data() }));
          checkReady();
        });

        // 2. [效能優化] 母專案：只監聽 'active' (需索引)
        const qProjects = query(
          collection(db, "projects"),
          where("status", "==", "active")
        );
        onSnapshot(qProjects, (s) => {
          this.activeParents = s.docs.map((d) => safeProject(d));
          this.buildIndexes();
          checkReady();
        });

        // 3. [效能優化] 子專案：只監聽 'setup' 或 'in_progress'
        const qSubs = query(
          collection(db, "sub_projects"),
          where("status", "in", ["setup", "in_progress"])
        );
        onSnapshot(qSubs, (s) => {
          this.activeSubs = s.docs.map((d) => safeSub(d));
          this.buildIndexes();
          checkReady();
        });

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
        console.error(e);
        this.dataReady = true;
      }
    },

    // [New] 延遲載入歷史資料
    async loadHistoryData() {
      if (this.isHistoryLoaded) return;
      this.isSubmitting = true;
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
        const qHistoryProjects = query(
          collection(db, "projects"),
          where("status", "in", ["completed", "aborted"])
        );
        const snapProj = await getDocs(qHistoryProjects);
        this.historyParents = snapProj.docs.map((d) => safeProject(d));

        const qHistorySubs = query(
          collection(db, "sub_projects"),
          where("status", "in", ["completed", "aborted"])
        );
        const snapSubs = await getDocs(qHistorySubs);
        this.historySubs = snapSubs.docs.map((d) => safeSub(d));

        this.isHistoryLoaded = true;
        this.buildIndexes();
        console.log(
          `歷史資料載入完畢: ${this.historyParents.length} 專案, ${this.historySubs.length} 子專案`
        );
      } catch (e) {
        console.error("載入歷史失敗", e);
      } finally {
        this.isSubmitting = false;
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
          activeTasks.push({ parent: item.parent, sub: sp, holdDays: hd });
        }
        if (sp.assignee === m.name) {
          if (
            this.memberDetailYear === "all" ||
            (sp.endDate && sp.endDate.startsWith(this.memberDetailYear))
          ) {
            overallCount++;
            const d =
              sp.finalDelayDays !== undefined
                ? sp.finalDelayDays
                : this.getSubProjectDelayDays(sp);
            if (d > 0 && sp.status !== "aborted") {
              overallDelay++;
              overallDelayDays += d;
            }
            if (
              (sp.status === "completed" || sp.status === "aborted") &&
              sp.delayReason
            )
              overallReasons[sp.delayReason] =
                (overallReasons[sp.delayReason] || 0) + 1;
            ownedList.push({ parent: item.parent, sub: sp });
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
      const n = prompt("品牌:");
      if (n) await addDoc(collection(db, "brands"), { name: n });
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
        await addDoc(
          collection(db, "projects"),
          DataFactory.createProject(this.projectForm, this.currentUser)
        );
        this.showProjectModal = false;
      } catch (e) {
        console.error(e);
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

    async saveSubProject() {
      if (!this.subProjectForm.title) return alert("請填寫名稱");
      this.isSubmitting = true;
      try {
        const newSub = DataFactory.createSubProject(
          this.subProjectForm,
          this.currentUser
        );

        // [防呆] 子專案起點不早於母專案
        const parentObj = this.indexedParentMap[this.subProjectForm.parentId];
        if (parentObj && parentObj.startDate) {
          if (newSub.startDate < parentObj.startDate) {
            newSub.startDate = parentObj.startDate;
          }
        }

        const docRef = await addDoc(collection(db, "sub_projects"), newSub);
        if (newSub.assignee !== this.currentUser.name)
          this.sendNotification(
            newSub.assignee,
            "task",
            `您被指派負責新專案: ${newSub.title}`,
            this.subProjectForm.parentId,
            docRef.id
          );
        this.showSubProjectModal = false;
      } catch (e) {
        console.error(e);
        alert("Error");
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
        // [防呆] 編輯檢查
        if (
          this.editBranchForm.startDate < this.currentParentProject.startDate
        ) {
          return alert(
            `錯誤：子專案開始日 (${this.editBranchForm.startDate}) 不可早於母專案開始日 (${this.currentParentProject.startDate})`
          );
        }

        await updateDoc(
          doc(db, "sub_projects", this.currentSubProject.id),
          this.editBranchForm
        );
        if (this.editBranchForm.assignee !== this.currentSubProject.assignee) {
          this.sendNotification(
            this.editBranchForm.assignee,
            "task",
            `您被指派負責專案: ${this.editBranchForm.title}`,
            this.currentParentProject.id,
            this.currentSubProject.id
          );
        }
        this.showEditBranchModal = false;
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
      if (this.currentSubProject.currentHandler !== this.currentUser.name)
        return;
      if (
        new Date(this.eventForm.date) <
        new Date(this.currentSubProject.startDate)
      ) {
        alert(
          `工作日誌日期 (${this.eventForm.date}) 不可早於子專案開始日 (${this.currentSubProject.startDate})`
        );
        return;
      }
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

      // [防呆] 若為最後一個節點，禁止轉移球權
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

      if (!this.currentSubProject.events) this.currentSubProject.events = [];
      this.currentSubProject.events.push(newEvent);
      const oldHandler = this.currentSubProject.currentHandler;
      this.currentSubProject.currentHandler = nextHandler;

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
          if (ms.id === lastMilestone.id) {
            const today = new Date(this.eventForm.date);
            const deadline = new Date(this.currentSubProject.endDate);
            const finalDelay = Math.floor((today - deadline) / 86400000);
            if (finalDelay > 0) {
              delayDetected = true;
              this.currentSubProject.events.pop();
              this.currentSubProject.currentHandler = oldHandler;
              ms.isCompleted = false;
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
              return;
            } else {
              isProjectCompleted = true;
              this.currentSubProject.status = "completed";
              this.currentSubProject.finalDelayDays = 0;
              this.currentSubProject.completedDate = this.eventForm.date;
              alert("恭喜！專案準時完成，自動結案。");
            }
          }
        }
      }
      this.showEventModal = false;
      try {
        const updates = {
          events: this.currentSubProject.events,
          currentHandler: nextHandler,
          milestones: this.currentSubProject.milestones,
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
          updates.status = "completed";
          updates.finalDelayDays = 0;
          updates.completedDate = this.eventForm.date;
        }
        await updateDoc(
          doc(db, "sub_projects", this.currentSubProject.id),
          updates
        );
      } catch (e) {
        console.error("Sync Failed", e);
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
      const prev = this.historyStack.pop();
      if (prev) {
        this.currentView = prev.view;
        if (prev.view === "parent_detail" && prev.parentId) {
          this.currentParentProject = this.indexedParentMap[prev.parentId];
          this.detailTab = "overview";
        }
      } else {
        this.currentView = "dashboard";
      }
    },
    selectParentProject(proj) {
      this.addToHistory();
      this.currentParentProject = proj;
      this.currentView = "parent_detail";
      this.detailTab = "overview";
    },
    selectSubProject(sp, parent) {
      this.addToHistory();
      this.currentParentProject = parent;
      this.currentSubProject = sp;
      this.currentView = "sub_project_detail";
      this.setupForm = {
        startDate: new Date().toISOString().split("T")[0],
        endDate: "",
        milestones: [],
      };
      this.detailTab = "events";
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
          this.currentSubProject.status = "completed";
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
        alert("資料已儲存");
        this.showDelayReasonModal = false;
        this.delayForm = { reason: "人力不足", remark: "" };
      } catch (e) {
        console.error(e);
        alert("儲存失敗，請檢查網路或重試：" + e.message);
      } finally {
        this.isSubmitting = false;
      }
    },
    async completeParentProject(proj) {
      if (confirm("全案歸檔？"))
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
    calcSubProjectHours(sp) {
      return (sp.events || []).reduce(
        (sum, ev) => sum + Number(ev.hours || 0),
        0
      );
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
      if (s === "completed") return "bg-emerald-100 text-emerald-700";
      if (s === "in_progress") return "bg-indigo-100 text-indigo-700";
      if (s === "aborted") return "bg-slate-200 text-slate-600";
      return "bg-yellow-100 text-yellow-700";
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
    getDateStyle(dateStr) {
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
    openQuickView(branch, parent) {
      this.quickViewData = { branch, parent };
      this.showQuickViewModal = true;
    },
    // [New] 快速檢視專用：取得排序後的里程碑與狀態
    getQuickViewMilestones(branch) {
      if (!branch.milestones) return [];
      // 依照日期排序
      const sorted = [...branch.milestones].sort(
        (a, b) => new Date(a.date) - new Date(b.date)
      );
      // 找出第一個「未完成」的節點索引，標記為 current
      const firstIncompleteIdx = sorted.findIndex((m) => !m.isCompleted);
      return sorted.map((m, idx) => ({
        ...m,
        // 如果全部都完成了，current 就是 -1 (沒有)，否則就是第一個未完成的
        isCurrent: firstIncompleteIdx !== -1 && idx === firstIncompleteIdx,
        isPast: m.isCompleted,
        isFuture:
          !m.isCompleted &&
          firstIncompleteIdx !== -1 &&
          idx > firstIncompleteIdx,
      }));
    },
  },
});

app.mount("#app");
