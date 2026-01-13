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

// [Budget Factory]
const BudgetFactory = {
  createCategory: (input, brandId, year) => ({
    brandId: brandId,
    year: year,
    name: input.name,
    budget: Number(input.budget) || 0,
    createdAt: new Date().toISOString(),
  }),
  createProposal: (input, categoryId, user) => ({
    categoryId: categoryId,
    title: input.title,
    amount: Number(input.amount) || 0,
    originalAmount: Number(input.amount) || 0, // [New] 紀錄原始規劃
    owner: user?.name || "Unknown",
    isClosed: false, // [New] 結案狀態
    overspendReason: "", // [New] 超支原因
    date: new Date().toISOString().split("T")[0],
    createdAt: new Date().toISOString(),
  }),
  createSubItem: (input, proposalId, user) => ({
    proposalId: proposalId,
    name: input.name,
    amount: Number(input.amount) || 0,
    owner: user?.name || "Unknown",
    overspendReason: "", // [New] 超支原因
    createdAt: new Date().toISOString(),
  }),
  createExpense: (input, subItemId, user) => ({
    subItemId: subItemId,
    event: input.event || "", // [New] 事件名稱
    vendor: input.vendor,
    invoiceNo: input.invoiceNo,
    invoiceDate: input.invoiceDate,
    amount: Number(input.amount) || 0,
    isRequested: input.isRequested || false,
    paymentDate: input.paymentDate || "",
    owner: user?.name || "Unknown",
    createdAt: new Date().toISOString(),
  }),
};

const DummyComponent = { template: "<div></div>" };

const routes = [
  { path: "/", name: "dashboard", component: DummyComponent },
  { path: "/report", name: "report", component: DummyComponent },
  { path: "/workspace", name: "workspace", component: DummyComponent },
  { path: "/project/:pid", name: "parent", component: DummyComponent },
  { path: "/project/:pid/sub/:sid", name: "sub", component: DummyComponent },
  { path: "/budget", name: "budget", component: DummyComponent },
];

const router = VueRouter.createRouter({
  history: VueRouter.createWebHistory("/mkt-dashboard/"),
  routes,
});

const app = createApp({
  data() {
    return {
      // --- PM System Data ---
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
      subProjectSearch: "",
      brandExpandedState: {},
      historyStack: [],
      currentYear: new Date().getFullYear(),
      currentMonth: new Date().getMonth() + 1,
      filterStatus: "all",
      users: [],
      currentUserId: null,
      brands: [],
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
        archived: "已歸檔",
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
      sidebarWidth: 256,
      isResizingSidebar: false,
      predefinedTags: ["急件", "設計", "數位廣告", "官網"],
      newTagInput: "",
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
        { name: "名單", milestones: [{ title: "提供名單" }] },
      ],
      selectedTemplateIndex: "",
      localFocusIds: [],
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
        group: "kanban",
        disabled: false,
        ghostClass: "sortable-ghost",
        forceFallback: false,
        delay: 0,
        touchStartThreshold: 3,
      },
      pokeCount: 0,
      headerTitle: "我的待辦任務",
      isHeaderSpinning: false,

      // --- Budget System Data ---
      budgetViewMode: "structure",
      selectedBudgetYear: new Date().getFullYear().toString(),
      selectedBudgetBrandId: "",
      selectedBudgetMonth: new Date().toISOString().slice(0, 7),
      monthlyBrandFilter: "all",
      categoryColors: [
        "bg-indigo-500 text-indigo-500",
        "bg-rose-500 text-rose-500",
        "bg-amber-400 text-amber-400",
        "bg-emerald-500 text-emerald-500",
        "bg-cyan-500 text-cyan-500",
        "bg-purple-500 text-purple-500",
      ],

      budgetCategories: [],
      budgetProposals: [],
      budgetSubItems: [],
      budgetExpenses: [],
      isBudgetLoaded: false,

      expandedProposals: [],
      showCategoryModal: false,
      categoryForm: { name: "", budget: 0 },
      currentCategoryEditId: null,

      showProposalModal: false,
      proposalForm: { title: "", amount: 0 },
      currentCategoryForAdd: null,

      showSubItemModal: false,
      subItemForm: { name: "", amount: 0 },
      isEditingSubItem: false,
      currentProposalForAdd: null,
      currentSubItemEditId: null,

      showExpenseModal: false,
      expenseForm: {
        event: "",
        vendor: "",
        invoiceNo: "",
        invoiceDate: "",
        amount: 0,
        isRequested: false,
        paymentDate: "",
        owner: "",
      },
      isEditingExpense: false,
      currentSubItemForExpense: null,
      currentExpenseEditId: null,
    };
  },
  async mounted() {
    router.afterEach((to) => {
      this.handleRouteUpdate(to);
    });
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
    const konamiCode = [
      "ArrowUp",
      "ArrowUp",
      "ArrowDown",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "ArrowLeft",
      "ArrowRight",
      "b",
      "a",
    ];
    let cursor = 0;
    window.addEventListener("keydown", (e) => {
      const key = e.key.toLowerCase();
      const targetKey = konamiCode[cursor].toLowerCase();
      if (key === targetKey) {
        cursor++;
        if (cursor === konamiCode.length) {
          if (this.triggerSuperParty) this.triggerSuperParty();
          cursor = 0;
        }
      } else {
        cursor = 0;
      }
    });
  },
  computed: {
    availableYears() {
      const startYear = 2026;
      const currentYear = new Date().getFullYear();
      const endYear = currentYear + 1;
      const years = [];
      for (let y = startYear; y <= endYear; y++) {
        years.push(y);
      }
      return years;
    },
    rawParents() {
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
    canEditSubProject() {
      if (!this.currentSubProject) return false;
      if (this.currentUser.role === "admin") return true;
      if (
        ["archived", "aborted", "completed"].includes(
          this.currentSubProject.status
        )
      )
        return false;
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

    // --- [Budget System] Computed (修復與優化) ---
    currentBudgetBrand() {
      return this.brands.find((b) => b.id === this.selectedBudgetBrandId) || {};
    },
    computedCategories() {
      if (!this.selectedBudgetBrandId) return [];
      return this.budgetCategories
        .filter(
          (c) =>
            c.brandId === this.selectedBudgetBrandId &&
            c.year == this.selectedBudgetYear
        )
        .map((cat) => {
          const props = this.budgetProposals.filter(
            (p) => p.categoryId === cat.id
          );
          // 已規劃 (Allocated) - 結案後會自動更新為實際值
          const used = props.reduce(
            (sum, p) => sum + (Number(p.amount) || 0),
            0
          );

          // 實際核銷 (Actual Used)
          const propIds = props.map((p) => p.id);
          const relatedSubItems = this.budgetSubItems.filter((s) =>
            propIds.includes(s.proposalId)
          );
          const subItemIds = relatedSubItems.map((s) => s.id);
          const actualUsed = this.budgetExpenses
            .filter((e) => subItemIds.includes(e.subItemId))
            .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

          return { ...cat, used, actualUsed };
        });
    },
    brandBudgetStats() {
      const cats = this.computedCategories;
      const allocatedToCategories = cats.reduce(
        (sum, c) => sum + (Number(c.budget) || 0),
        0
      );
      const total = allocatedToCategories;
      const used = cats.reduce((sum, c) => sum + (c.used || 0), 0);
      return {
        total,
        allocatedToCategories,
        used,
        remaining: total - used,
        progress: total ? Math.round((used / total) * 100) : 0,
      };
    },
    monthlyExpensesList() {
      return this.budgetExpenses
        .filter((e) => {
          if (!e.paymentDate) return false;
          if (!e.paymentDate.startsWith(this.selectedBudgetMonth)) return false;
          const sub = this.budgetSubItems.find((s) => s.id === e.subItemId);
          if (!sub) return false;
          const prop = this.budgetProposals.find(
            (p) => p.id === sub.proposalId
          );
          if (!prop) return false;
          const cat = this.budgetCategories.find(
            (c) => c.id === prop.categoryId
          );
          if (
            this.selectedBudgetBrandId &&
            (!cat || cat.brandId !== this.selectedBudgetBrandId)
          ) {
            return false;
          }
          return true;
        })
        .map((e) => {
          const sub =
            this.budgetSubItems.find((s) => s.id === e.subItemId) || {};
          const prop =
            this.budgetProposals.find((p) => p.id === sub.proposalId) || {};
          const cat =
            this.budgetCategories.find((c) => c.id === prop.categoryId) || {};
          return { exp: e, sub, prop, cat };
        })
        .sort(
          (a, b) => new Date(a.exp.paymentDate) - new Date(b.exp.paymentDate)
        );
    },
    monthlyStats() {
      const totalPaid = this.monthlyExpensesList.reduce(
        (sum, item) => sum + (Number(item.exp.amount) || 0),
        0
      );
      return { totalPaid };
    },

    sortedMilestones() {
      if (!this.currentSubProject) return [];
      return [...(this.currentSubProject.milestones || [])].sort(
        (a, b) => new Date(a.date) - new Date(b.date)
      );
    },
    archivedProjects() {
      if (!this.rawParents) return [];
      let list = this.rawParents.filter(
        (p) => p.status === "archived" || p.status === "aborted"
      );
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
            let targetDate = sp.endDate || "9999-12-31";
            let targetLabel = "專案截止";
            let isMilestone = false;
            if (sp.milestones && sp.milestones.length > 0) {
              const sorted = [...sp.milestones].sort(
                (m1, m2) => new Date(m1.date) - new Date(m2.date)
              );
              const nextMs = sorted.find((m) => !m.isCompleted);
              if (nextMs) {
                targetDate = nextMs.date;
                targetLabel = nextMs.title;
                isMilestone = true;
              }
            }
            list.push({
              brand: { name: brandName },
              parent: p,
              sub: sp,
              displayInfo: { targetDate, targetLabel, isMilestone },
            });
          }
        });
      });
      return list.sort((a, b) => {
        const dateA = new Date(a.displayInfo.targetDate);
        const dateB = new Date(b.displayInfo.targetDate);
        if (dateA.getTime() !== dateB.getTime()) return dateA - dateB;
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
        act: Math.round(act * 10) / 10,
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
    memberHoursStats() {
      const stats = {};
      this.users
        .filter((u) => u.role !== "admin")
        .forEach(
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
      return Object.values(stats)
        .map((s) => ({ ...s, hours: Math.round(s.hours * 10) / 10 }))
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
          hours: Math.round(hours * 10) / 10,
          percent: totalAll ? Math.round((hours / totalAll) * 100) : 0,
        }))
        .sort((a, b) => b.hours - a.hours);
    },
    kanbanColumns() {
      const myTasks = [];
      const focusIds = this.localFocusIds || [];
      const keyword = (this.subProjectSearch || "").toLowerCase().trim();
      this.rawParents.forEach((p) => {
        const subs = this.indexedSubsByParent[p.id] || [];
        subs.forEach((s) => {
          if (
            s.currentHandler === this.currentUser.name ||
            (s.assignee === this.currentUser.name &&
              s.currentHandler === "Unassigned")
          ) {
            if (
              s.status !== "completed" &&
              s.status !== "archived" &&
              s.status !== "aborted"
            ) {
              if (keyword) {
                const matchTitle = s.title.toLowerCase().includes(keyword);
                const matchParent = p.title.toLowerCase().includes(keyword);
                const brandName = this.indexedBrandMap[p.brandId] || "";
                const matchBrand = brandName.toLowerCase().includes(keyword);
                if (!matchTitle && !matchParent && !matchBrand) return;
              }
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
      const getSortScore = (item) => {
        const now = new Date();
        const todayStr = now.toISOString().split("T")[0];
        let targetDateStr = item.endDate || "9999-12-31";
        if (item.milestones && item.milestones.length > 0) {
          const nextMs = item.milestones
            .filter((m) => !m.isCompleted && m.date)
            .sort((a, b) => new Date(a.date) - new Date(b.date))[0];
          if (nextMs) targetDateStr = nextMs.date;
        }
        const targetDate = new Date(targetDateStr);
        let score = targetDate.getTime();
        if (targetDateStr < todayStr) score -= 1000000000000;
        else if (
          new Date(now.getTime() + 2 * 86400000).toISOString().split("T")[0] >
          targetDateStr
        )
          score -= 100000000000;
        return score;
      };
      const sortFn = (a, b) => getSortScore(a) - getSortScore(b);
      return {
        inbox: myTasks.filter((t) => t.status === "setup"),
        today: myTasks
          .filter(
            (t) =>
              t.status === "in_progress" &&
              !t.isWaitingForManager &&
              focusIds.includes(t.id)
          )
          .sort(sortFn),
        backlog: myTasks
          .filter(
            (t) =>
              t.status === "in_progress" &&
              !t.isWaitingForManager &&
              !focusIds.includes(t.id)
          )
          .sort(sortFn),
        review: myTasks
          .filter((t) => t.status === "in_progress" && t.isWaitingForManager)
          .sort(sortFn),
      };
    },
  },
  watch: {
    currentView(newView) {
      if (newView === "history_report" || newView === "parent_detail") {
        this.loadHistoryData();
      } else if (newView === "budget") {
        this.loadBudgetData();
        if (this.brands.length > 0 && !this.selectedBudgetBrandId) {
          this.selectedBudgetBrandId = this.brands[0].id;
        }
      }
    },
    showArchived(isShown) {
      if (isShown) this.loadHistoryData();
    },
    memberDetailYear(newYear) {
      if (newYear !== "all" && newYear < new Date().getFullYear())
        this.loadHistoryData();
    },
    dataReady(isReady) {
      if (isReady) this.handleRouteUpdate(this.$route);
    },
    subProjectSearch(val) {
      if (!val) return;
      const cmd = val.toLowerCase().trim();
      if (cmd === "snow") {
        this.triggerSnow();
        this.subProjectSearch = "";
      } else if (cmd === "matrix") {
        document.body.classList.toggle("matrix-mode");
        document.body.classList.remove("disco-mode");
        this.subProjectSearch = "";
      } else if (cmd === "disco") {
        document.body.classList.toggle("disco-mode");
        document.body.classList.remove("matrix-mode");
        this.subProjectSearch = "";
      } else if (cmd === "clean" || cmd === "reset") {
        document.body.classList.remove("matrix-mode");
        document.body.classList.remove("disco-mode");
        this.subProjectSearch = "";
      }
    },
    "kanbanColumns.today"(newVal) {
      if (newVal.length === 0) this.refreshCheer();
    },
    brands(newVal) {
      if (newVal.length > 0 && !this.selectedBudgetBrandId) {
        this.selectedBudgetBrandId = newVal[0].id;
      }
    },
  },

  methods: {
    // --- Utils ---
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
    // ... (Init, Fetch)
    initListeners() {
      try {
        this.requestNotificationPermission();
        onSnapshot(collection(db, "users"), (s) => {
          this.users = s.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .sort((a, b) => (a.team || "").localeCompare(b.team || ""));
          if (this.currentUserId) {
            const myself = this.users.find((u) => u.id === this.currentUserId);
            if (myself && myself.focusIds) {
              this.localFocusIds = myself.focusIds;
            }
          }
          if (!this.dataReady) this.dataReady = true;
        });
        onSnapshot(collection(db, "brands"), (s) => {
          this.brands = s.docs.map((d) => ({ id: d.id, ...d.data() }));
          this.rebuildBrandMap();
        });
        this.fetchDashboardData();
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
        console.error("Init Listeners Error:", e);
        this.dataReady = true;
      }
    },
    async fetchDashboardData() {
      if (this.isDashboardLoading) return;
      this.isDashboardLoading = true;
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
        const qProjects = query(
          collection(db, "projects"),
          where("status", "==", "active")
        );
        const snapProj = await getDocs(qProjects);
        this.activeParents = snapProj.docs.map((d) => safeProject(d));
        const qSubs = query(
          collection(db, "sub_projects"),
          where("status", "in", ["setup", "in_progress"])
        );
        const snapSubs = await getDocs(qSubs);
        this.activeSubs = snapSubs.docs.map((d) => safeSub(d));
        this.buildIndexes();
      } catch (e) {
        console.error(e);
      } finally {
        this.isDashboardLoading = false;
      }
    },
    async loadHistoryData() {
      if (this.isHistoryLoaded) return;
      this.isLoading = true;
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
          where("status", "in", ["completed", "aborted", "archived"]),
          orderBy("startDate", "desc"),
          limit(100)
        );
        const snapProj = await getDocs(qHistoryProjects);
        this.historyParents = snapProj.docs.map((d) => safeProject(d));
        const qHistorySubs = query(
          collection(db, "sub_projects"),
          where("status", "in", ["completed", "aborted"]),
          orderBy("endDate", "desc"),
          limit(300)
        );
        const snapSubs = await getDocs(qHistorySubs);
        this.historySubs = snapSubs.docs.map((d) => safeSub(d));
        this.isHistoryLoaded = true;
        this.buildIndexes();
      } catch (err) {
        console.error(err);
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
          let dateForFilter = sp.endDate;
          if (sp.status === "setup" && !dateForFilter)
            dateForFilter = sp.startDate;
          if (
            this.memberDetailYear === "all" ||
            (dateForFilter && dateForFilter.startsWith(this.memberDetailYear))
          ) {
            overallCount++;
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

    // ... (PM Methods)
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
        const newProjectData = DataFactory.createProject(
          this.projectForm,
          this.currentUser
        );
        const docRef = await addDoc(collection(db, "projects"), newProjectData);
        const newProject = { id: docRef.id, ...newProjectData };
        this.activeParents.push(newProject);
        this.indexedParentMap[docRef.id] = newProject;
        this.showProjectModal = false;
        this.$router.push({ name: "parent", params: { pid: docRef.id } });
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
    addTag(targetForm) {
      const val = this.newTagInput.trim();
      if (!val) return;
      if (!targetForm.tags) targetForm.tags = [];
      if (!targetForm.tags.includes(val)) {
        targetForm.tags.push(val);
      }
      this.newTagInput = "";
    },
    removeTag(targetForm, index) {
      targetForm.tags.splice(index, 1);
    },
    getTagStyle(tagName) {
      if (tagName === "急件")
        return "bg-red-100 text-red-600 border border-red-200";
      if (tagName === "設計")
        return "bg-purple-100 text-purple-600 border border-purple-200";
      if (tagName === "數位廣告")
        return "bg-blue-100 text-blue-600 border border-blue-200";
      if (tagName === "官網")
        return "bg-pink-100 text-pink-600 border border-pink-200";
      return "bg-slate-100 text-slate-600 border border-slate-200";
    },
    async saveSubProject() {
      if (!this.subProjectForm.title) return alert("請填寫名稱");
      this.isSubmitting = true;
      try {
        const newSubData = DataFactory.createSubProject(
          this.subProjectForm,
          this.currentUser
        );
        const parentObj = this.indexedParentMap[this.subProjectForm.parentId];
        if (parentObj && parentObj.startDate) {
          if (newSubData.startDate < parentObj.startDate) {
            newSubData.startDate = parentObj.startDate;
          }
        }
        const docRef = await addDoc(collection(db, "sub_projects"), newSubData);
        if (newSubData.assignee !== this.currentUser.name) {
          this.sendNotification(
            newSubData.assignee,
            "task",
            `您被指派負責新專案: ${newSubData.title}`,
            this.subProjectForm.parentId,
            docRef.id
          );
        }
        const newSub = { id: docRef.id, ...newSubData };
        this.activeSubs.push(newSub);
        if (!this.indexedSubsByParent[this.subProjectForm.parentId]) {
          this.indexedSubsByParent[this.subProjectForm.parentId] = [];
        }
        this.indexedSubsByParent[this.subProjectForm.parentId].push(newSub);
        this.showSubProjectModal = false;
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
        if (
          this.editBranchForm.startDate < this.currentParentProject.startDate
        ) {
          return alert(
            `錯誤：子專案開始日 (${this.editBranchForm.startDate}) 不可早於母專案開始日 (${this.currentParentProject.startDate})`
          );
        }
        const updateData = {
          ...this.editBranchForm,
          tags: this.editBranchForm.tags || [],
        };
        await updateDoc(
          doc(db, "sub_projects", this.currentSubProject.id),
          updateData
        );
        if (this.editBranchForm.assignee !== this.currentSubProject.assignee) {
          await this.sendNotification(
            this.editBranchForm.assignee,
            "task",
            `您被指派負責專案: ${this.editBranchForm.title}`,
            this.currentParentProject.id,
            this.currentSubProject.id
          );
        }
        Object.assign(this.currentSubProject, updateData);
        this.showEditBranchModal = false;
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
      const newTotalHours = this.currentSubProject.events.reduce(
        (sum, ev) => sum + Number(ev.hours || 0),
        0
      );
      const roundedTotal = Math.round(newTotalHours * 10) / 10;
      this.currentSubProject.totalHours = roundedTotal;
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
              this.currentSubProject.status = "archived";
              this.currentSubProject.finalDelayDays = 0;
              this.currentSubProject.completedDate = this.eventForm.date;
              this.triggerConfetti();
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
          updates.status = "completed";
          updates.finalDelayDays = 0;
          updates.completedDate = this.eventForm.date;
        }
        await updateDoc(
          doc(db, "sub_projects", this.currentSubProject.id),
          updates
        );
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
    triggerConfetti() {
      const audio = document.getElementById("notification-sound");
      if (audio) {
        audio.currentTime = 0;
        audio.play().catch((e) => console.log("Audio play blocked", e));
      }
      const mode = Math.floor(Math.random() * 3);
      if (mode === 0) {
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
      } else if (mode === 1) {
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
      } else {
        const count = 200;
        const defaults = { origin: { y: 0.7 } };
        const goldColors = ["#FFD700", "#F0E68C", "#DAA520"];
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
      this.$router.back();
    },
    selectParentProject(proj) {
      this.$router.push({ name: "parent", params: { pid: proj.id } });
    },
    pokeHeader() {
      this.pokeCount++;
      this.isHeaderSpinning = true;
      setTimeout(() => {
        this.isHeaderSpinning = false;
      }, 500);
      if (this.pokeCount >= 5) {
        const originalTitle = "我的待辦任務";
        this.headerTitle = "別戳了！快去工作！💢";
        setTimeout(() => {
          this.headerTitle = originalTitle;
          this.pokeCount = 0;
        }, 3000);
      }
    },
    triggerSuperParty() {
      if (!window.confetti) return;
      console.log("Konami Code Activated! 🚀");
      const duration = 3000;
      const end = Date.now() + duration;
      (function frame() {
        confetti({ particleCount: 5, angle: 60, spread: 55, origin: { x: 0 } });
        confetti({
          particleCount: 5,
          angle: 120,
          spread: 55,
          origin: { x: 1 },
        });
        if (Date.now() < end) {
          requestAnimationFrame(frame);
        }
      })();
    },
    triggerSnow() {
      if (!window.confetti) return;
      const duration = 5000;
      const end = Date.now() + duration;
      (function frame() {
        confetti({
          particleCount: 1,
          startVelocity: 0,
          ticks: 200,
          origin: { x: Math.random(), y: Math.random() * 0.1 },
          colors: ["#ffffff"],
          shapes: ["circle"],
          gravity: 0.6,
          scalar: 0.8,
          drift: 0,
        });
        if (Date.now() < end) {
          requestAnimationFrame(frame);
        }
      })();
      console.log("❄️ Winter is coming...");
    },
    selectSubProject(sp, parent) {
      this.$router.push({
        name: "sub",
        params: { pid: parent.id, sid: sp.id },
      });
    },
    getTaskTargetDate(item) {
      if (item.milestones && item.milestones.length > 0) {
        const nextMs = item.milestones
          .filter((m) => !m.isCompleted && m.date)
          .sort((a, b) => new Date(a.date) - new Date(b.date))[0];
        if (nextMs) return nextMs.date;
      }
      return item.endDate;
    },
    getTaskTargetLabel(item) {
      if (item.milestones && item.milestones.length > 0) {
        const nextMs = item.milestones
          .filter((m) => !m.isCompleted && m.date)
          .sort((a, b) => new Date(a.date) - new Date(b.date))[0];
        if (nextMs) return nextMs.title;
      }
      return "專案結束";
    },
    getKanbanDateClass(item) {
      const targetDateStr = this.getTaskTargetDate(item);
      if (!targetDateStr) return "text-slate-400";
      const now = new Date();
      const todayStr = now.toISOString().split("T")[0];
      const lagDate = new Date();
      lagDate.setDate(lagDate.getDate() + 3);
      const lagDateStr = lagDate.toISOString().split("T")[0];
      if (targetDateStr < todayStr) return "text-red-600 animate-pulse";
      if (targetDateStr <= lagDateStr) return "text-orange-500";
      return "text-slate-400";
    },
    getProjectProgress(item) {
      if (!item.milestones || item.milestones.length === 0) return 0;
      const completed = item.milestones.filter((m) => m.isCompleted).length;
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
          this.historySubs.push({ ...this.currentSubProject });
          this.buildIndexes();
          if (this.currentSubProject.status !== "aborted") {
            this.triggerConfetti();
          }
        }
        this.showDelayReasonModal = false;
        this.delayForm = { reason: "人力不足", remark: "" };
      } catch (e) {
        console.error(e);
        alert("儲存失敗，請檢查網路或重試：" + e.message);
      } finally {
        this.isSubmitting = false;
      }
    },
    async archiveProject(project) {
      if (!confirm(`確定要將專案「${project.title}」歸檔嗎？`)) return;
      try {
        await updateDoc(doc(db, "projects", project.id), {
          status: "archived",
        });
        project.status = "archived";
        this.currentView = "dashboard";
        this.loadHistoryData();
        alert("專案已歸檔！");
      } catch (e) {
        console.error(e);
        alert("歸檔失敗");
      }
    },
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
    calcSubProjectHours(sp) {
      if (sp.totalHours !== undefined) {
        return sp.totalHours;
      }
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
      if (s === "setup")
        return "bg-yellow-100 text-yellow-700 border border-yellow-200";
      if (s === "completed") return "bg-emerald-100 text-emerald-700";
      if (s === "in_progress") return "bg-indigo-100 text-indigo-700";
      if (s === "aborted") return "bg-slate-200 text-slate-600";
      if (s === "archived") return "bg-gray-800 text-gray-300";
      return "bg-slate-100 text-slate-500";
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
      if (["completed", "archived", "aborted"].includes(status)) {
        return "text-slate-500 font-medium";
      }
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
    openQuickView(branch, parent, brand) {
      this.quickViewData = { branch, parent, brand };
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
    getMilestoneHours(branch, milestoneId) {
      if (!branch || !branch.events || !branch.milestones) return 0;
      const sortedMs = [...branch.milestones].sort(
        (a, b) => new Date(a.date) - new Date(b.date)
      );
      const currentIdx = sortedMs.findIndex((m) => m.id === milestoneId);
      if (currentIdx === -1) return 0;
      const currentEndDate = new Date(sortedMs[currentIdx].date);
      currentEndDate.setHours(23, 59, 59, 999);
      let prevEndDate;
      if (currentIdx === 0) {
        prevEndDate = new Date("1970-01-01");
      } else {
        prevEndDate = new Date(sortedMs[currentIdx - 1].date);
        prevEndDate.setHours(23, 59, 59, 999);
      }
      const total = branch.events.reduce((sum, ev) => {
        const evDate = new Date(ev.date);
        if (evDate > prevEndDate && evDate <= currentEndDate) {
          return sum + Number(ev.hours || 0);
        }
        return sum;
      }, 0);
      return Math.round(total * 10) / 10;
    },
    startResizeSidebar(e) {
      this.isResizingSidebar = true;
      document.addEventListener("mousemove", this.handleSidebarResize);
      document.addEventListener("mouseup", this.stopResizeSidebar);
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";
    },
    handleSidebarResize(e) {
      if (!this.isResizingSidebar) return;
      const minWidth = 200;
      const maxWidth = 600;
      let newWidth = e.clientX;
      if (newWidth < minWidth) newWidth = minWidth;
      if (newWidth > maxWidth) newWidth = maxWidth;
      this.sidebarWidth = newWidth;
    },
    stopResizeSidebar() {
      this.isResizingSidebar = false;
      document.removeEventListener("mousemove", this.handleSidebarResize);
      document.removeEventListener("mouseup", this.stopResizeSidebar);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    },
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
        this.currentView = "parent_detail";
      } catch (e) {
        console.error(e);
        alert("刪除失敗");
      }
    },
    async adminMoveSubProject() {
      if (this.currentUser.role !== "admin") return;
      console.log("可用母專案清單:", this.rawParents);
      const newParentId = prompt(
        "請輸入目標母專案的 ID (請按 F12 看 Console 或從網址列複製 ID):"
      );
      if (!newParentId) return;
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
        this.currentView = "dashboard";
      } catch (e) {
        console.error(e);
        alert("搬移失敗");
      }
    },
    async updateParentDates() {
      if (this.currentUser.role !== "admin") return;
      try {
        await updateDoc(doc(db, "projects", this.currentParentProject.id), {
          startDate: this.currentParentProject.startDate,
          endDate: this.currentParentProject.endDate,
        });
        console.log("母專案日期已更新");
      } catch (e) {
        console.error("更新日期失敗", e);
        alert("更新失敗，請檢查權限或網路");
      }
    },
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
        id: "ms" + Date.now(),
        title: title,
        date: date,
        isCompleted: false,
      };
      try {
        if (!this.currentSubProject.milestones)
          this.currentSubProject.milestones = [];
        this.currentSubProject.milestones.push(newMs);
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
    async deleteMilestone(msId) {
      if (this.currentUser.role !== "admin") return;
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
        this.currentSubProject.milestones =
          this.currentSubProject.milestones.filter((m) => m.id !== msId);
        await updateDoc(doc(db, "sub_projects", this.currentSubProject.id), {
          milestones: this.currentSubProject.milestones,
        });
      } catch (e) {
        console.error(e);
        alert("刪除失敗");
      }
    },
    async updateMilestone() {
      if (this.currentUser.role !== "admin") return;
      try {
        this.currentSubProject.milestones.forEach((m) => {
          if (m.isCompleted && m.completedDate && m.date) {
            const actual = new Date(m.completedDate);
            const plan = new Date(m.date);
            m.diffDays = Math.floor((actual - plan) / (1000 * 60 * 60 * 24));
          }
        });
        this.currentSubProject.milestones.sort(
          (a, b) => new Date(a.date) - new Date(b.date)
        );
        await updateDoc(doc(db, "sub_projects", this.currentSubProject.id), {
          milestones: this.currentSubProject.milestones,
        });
        console.log("節點更新成功 (已重算延遲天數)");
      } catch (e) {
        console.error(e);
        alert("更新存檔失敗");
      }
    },
    async updateEventLog() {
      if (this.currentUser.role !== "admin") return;
      try {
        const newTotalHours = this.currentSubProject.events.reduce(
          (sum, ev) => sum + Number(ev.hours || 0),
          0
        );
        const roundedTotal = Math.round(newTotalHours * 10) / 10;
        this.currentSubProject.totalHours = roundedTotal;
        await updateDoc(doc(db, "sub_projects", this.currentSubProject.id), {
          events: this.currentSubProject.events,
          totalHours: roundedTotal,
        });
      } catch (e) {
        console.error(e);
        alert("修正失敗");
      }
    },
    async handleRouteUpdate(route) {
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
        case "budget":
          this.currentView = "budget_center";
          this.loadBudgetData();
          break;
        case "parent": {
          const pid = route.params.pid;
          let parent = this.indexedParentMap[pid];
          if (!parent && !this.isHistoryLoaded) {
            console.log("快取未命中，嘗試載入歷史資料...");
            await this.loadHistoryData();
            parent = this.indexedParentMap[pid];
          }
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
                this.indexedParentMap[pid] = parent;
                this.activeParents.push(parent);
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
          let s = this.activeSubs.find((sub) => sub.id === sid);
          if (!s) s = this.historySubs.find((sub) => sub.id === sid);
          if ((!p || !s) && !this.isHistoryLoaded) {
            await this.loadHistoryData();
            p = this.indexedParentMap[subPid];
            if (!s) s = this.activeSubs.find((sub) => sub.id === sid);
            if (!s) s = this.historySubs.find((sub) => sub.id === sid);
          }
          if (!p || !s) {
            console.log("快取未命中，啟動單筆救援 (子專案)...");
            try {
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
                  this.activeSubs.push(s);
                  if (!this.indexedSubsByParent[subPid])
                    this.indexedSubsByParent[subPid] = [];
                  this.indexedSubsByParent[subPid].push(s);
                }
              }
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
      this.showMobileSidebar = false;
      if (pageName === "dashboard") this.$router.push("/");
      if (pageName === "report") this.$router.push("/report");
      if (pageName === "workspace") this.$router.push("/workspace");
      if (pageName === "budget") this.$router.push("/budget");
    },
    applyTemplate() {
      if (this.selectedTemplateIndex === "") return;
      const template = this.projectTemplates[this.selectedTemplateIndex];
      const baseDateStr = this.setupForm.startDate;
      const hasBaseDate = baseDateStr && baseDateStr.trim() !== "";
      const baseDate = hasBaseDate ? new Date(baseDateStr) : null;
      template.milestones.forEach((tm) => {
        let dateStr = "";
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
          date: dateStr,
          isCompleted: false,
        });
      });
      const validDates = this.setupForm.milestones.filter((m) => m.date !== "");
      if (validDates.length > 0) {
        validDates.sort((a, b) => new Date(a.date) - new Date(b.date));
        this.setupForm.endDate = validDates[validDates.length - 1].date;
      }
      alert(`模板「${template.name}」載入完成！`);
      this.selectedTemplateIndex = "";
    },
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
    async onKanbanChange(evt, targetColumn) {
      if (evt.added) {
        const item = evt.added.element;
        if (targetColumn === "today") {
          if (!this.localFocusIds.includes(item.id)) {
            this.localFocusIds.push(item.id);
            this.syncFocusIdsToFirebase();
          }
          if (item.status === "setup") {
            this.currentSubProject = item;
            this.currentParentProject = item.parentObj;
            item.status = "in_progress";
            await updateDoc(doc(db, "sub_projects", item.id), {
              status: "in_progress",
            });
          }
          if (item.isWaitingForManager) {
            this.currentSubProject = item;
            await this.finishManagerCheck();
          }
        } else if (targetColumn === "backlog") {
          const idx = this.localFocusIds.indexOf(item.id);
          if (idx > -1) {
            this.localFocusIds.splice(idx, 1);
            this.syncFocusIdsToFirebase();
          }
          if (item.status === "setup") {
            item.status = "in_progress";
            await updateDoc(doc(db, "sub_projects", item.id), {
              status: "in_progress",
            });
          }
          if (item.isWaitingForManager) {
            this.currentSubProject = item;
            await this.finishManagerCheck();
          }
        } else if (targetColumn === "review") {
          const idx = this.localFocusIds.indexOf(item.id);
          if (idx > -1) {
            this.localFocusIds.splice(idx, 1);
            this.syncFocusIdsToFirebase();
          }
          this.currentSubProject = item;
          await this.startManagerCheck();
        } else if (targetColumn === "done") {
          const idx = this.localFocusIds.indexOf(item.id);
          if (idx > -1) {
            this.localFocusIds.splice(idx, 1);
            this.syncFocusIdsToFirebase();
          }
          this.currentSubProject = item;
          if (confirm(`確定要將「${item.title}」結案嗎？`)) {
            item.status = "completed";
            item.finalDelayDays = 0;
            item.completedDate = new Date().toISOString().split("T")[0];
            await updateDoc(doc(db, "sub_projects", item.id), {
              status: "completed",
              completedDate: item.completedDate,
              finalDelayDays: 0,
            });
            this.triggerConfetti();
            this.historySubs.push(item);
            this.buildIndexes();
          } else {
            this.fetchDashboardData();
          }
        }
      }
    },
    getDragSourceColumn(item) {
      if (item.status === "setup") return "inbox";
      if (item.isWaitingForManager) return "review";
      if (this.localFocusIds.includes(item.id)) return "today";
      return "backlog";
    },

    // --- [Budget System] Methods ---
    loadBudgetData() {
      if (this.isBudgetLoaded) return;
      console.log("正在載入預算系統資料...");

      onSnapshot(collection(db, "budget_categories"), (snap) => {
        this.budgetCategories = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }));
      });
      onSnapshot(collection(db, "budget_proposals"), (snap) => {
        this.budgetProposals = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }));
      });
      onSnapshot(collection(db, "budget_sub_items"), (snap) => {
        this.budgetSubItems = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      });
      onSnapshot(collection(db, "budget_expenses"), (snap) => {
        this.budgetExpenses = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        this.isBudgetLoaded = true;
      });
    },
    formatCurrency(val) {
      return new Intl.NumberFormat("zh-TW", {
        style: "currency",
        currency: "TWD",
        minimumFractionDigits: 0,
      }).format(val || 0);
    },
    getCategoryColor(index) {
      const colors = [
        "bg-indigo-500 text-indigo-500",
        "bg-rose-500 text-rose-500",
        "bg-amber-400 text-amber-400",
        "bg-emerald-500 text-emerald-500",
        "bg-cyan-500 text-cyan-500",
        "bg-purple-500 text-purple-500",
      ];
      return colors[index % colors.length];
    },
    getProposalsByCategory(catId) {
      return this.budgetProposals
        .filter((p) => p.categoryId === catId)
        .map((p) => {
          const mySubs = this.budgetSubItems.filter(
            (s) => s.proposalId === p.id
          );
          let actual = 0;
          mySubs.forEach((s) => {
            const subExps = this.budgetExpenses.filter(
              (e) => e.subItemId === s.id
            );
            actual += subExps.reduce(
              (sum, e) => sum + (Number(e.amount) || 0),
              0
            );
          });
          return { ...p, actualTotal: actual };
        });
    },
    getSubItemsByProposal(propId) {
      return this.budgetSubItems
        .filter((s) => s.proposalId === propId)
        .map((s) => {
          const subExps = this.budgetExpenses.filter(
            (e) => e.subItemId === s.id
          );
          const totalExpense = subExps.reduce(
            (sum, e) => sum + (Number(e.amount) || 0),
            0
          );
          return { ...s, totalExpense };
        });
    },
    getExpensesBySubItem(subId) {
      return this.budgetExpenses.filter((e) => e.subItemId === subId);
    },
    toggleProposalExpand(id) {
      const i = this.expandedProposals.indexOf(id);
      if (i > -1) this.expandedProposals.splice(i, 1);
      else this.expandedProposals.push(id);
    },
    getProgressBarColor(u, t) {
      if (t === 0) return "bg-slate-300";
      const ratio = u / t;
      return ratio > 1
        ? "bg-red-500"
        : ratio > 0.8
        ? "bg-orange-400"
        : "bg-emerald-500";
    },
    getUsageColor(u, t) {
      if (t === 0) return "text-slate-400";
      const ratio = u / t;
      return ratio > 1
        ? "text-red-600"
        : ratio > 0.8
        ? "text-orange-600"
        : "text-emerald-600";
    },
    getExpenseStatus(exp) {
      if (!exp.isRequested)
        return { label: "未請款", class: "bg-slate-100 text-slate-500" };
      if (!exp.paymentDate)
        return { label: "請款中", class: "bg-blue-100 text-blue-700" };
      const today = new Date().toISOString().split("T")[0];
      if (exp.paymentDate <= today)
        return { label: "已付款", class: "bg-emerald-100 text-emerald-700" };
      return { label: "請款中", class: "bg-blue-100 text-blue-700" };
    },

    canManage(item) {
      return (
        this.currentUser.role === "admin" ||
        item.owner === this.currentUser.name
      );
    },
    canManageCategory() {
      return (
        this.currentUser.role === "admin" ||
        this.currentUser.role === "director"
      );
    },

    openCategoryModal(cat = null) {
      if (!this.canManageCategory()) return alert("權限不足：僅主管可操作");
      if (cat) {
        this.currentCategoryEditId = cat.id;
        this.categoryForm = { name: cat.name, budget: cat.budget };
      } else {
        this.currentCategoryEditId = null;
        this.categoryForm = { name: "", budget: 0 };
      }
      this.showCategoryModal = true;
    },
    async saveCategory() {
      if (!this.categoryForm.name) return;
      this.isSubmitting = true;
      try {
        if (this.currentCategoryEditId) {
          await updateDoc(
            doc(db, "budget_categories", this.currentCategoryEditId),
            {
              name: this.categoryForm.name,
              budget: Number(this.categoryForm.budget) || 0,
            }
          );
        } else {
          const newData = BudgetFactory.createCategory(
            this.categoryForm,
            this.selectedBudgetBrandId,
            this.selectedBudgetYear
          );
          await addDoc(collection(db, "budget_categories"), newData);
        }
        this.showCategoryModal = false;
      } catch (e) {
        console.error(e);
        alert("儲存失敗");
      } finally {
        this.isSubmitting = false;
      }
    },
    async deleteCategory(id) {
      if (!this.canManageCategory()) return alert("權限不足");
      if (
        !confirm("確定刪除此預算大項？\n(注意：其下的簽呈與數據將會失去關聯)")
      )
        return;
      try {
        await deleteDoc(doc(db, "budget_categories", id));
      } catch (e) {
        console.error(e);
        alert("刪除失敗");
      }
    },

    openProposalModal(cat) {
      this.currentCategoryForAdd = cat;
      this.proposalForm = { title: "", amount: 0 };
      this.showProposalModal = true;
    },

    // [Mod] 簽呈新增 (允許超支)
    async saveProposal() {
      if (!this.proposalForm.title) return;
      const cat = this.currentCategoryForAdd;
      const currentUsed = this.budgetProposals
        .filter((p) => p.categoryId === cat.id)
        .reduce((s, p) => s + p.amount, 0);
      const remaining = cat.budget - currentUsed;
      let overReason = "";

      if (this.proposalForm.amount > remaining) {
        const reason = prompt(
          `⚠️ [超支警示]\n\n此簽呈金額 ($${this.formatCurrency(
            this.proposalForm.amount
          )}) 已超過大項剩餘預算 ($${this.formatCurrency(
            remaining
          )})！\n\n請輸入「超支理由」以強制建立：`
        );
        if (reason === null) return;
        if (!reason.trim()) return alert("必須填寫理由才能超支！");
        overReason = reason;
      }

      this.isSubmitting = true;
      try {
        const newData = {
          ...BudgetFactory.createProposal(
            this.proposalForm,
            this.currentCategoryForAdd.id,
            this.currentUser
          ),
          overspendReason: overReason,
        };
        await addDoc(collection(db, "budget_proposals"), newData);
        this.showProposalModal = false;
      } catch (e) {
        console.error(e);
        alert("新增失敗");
      } finally {
        this.isSubmitting = false;
      }
    },
    async deleteProposal(prop) {
      if (!this.canManage(prop)) return alert("權限不足");
      if (!confirm(`確定刪除簽呈「${prop.title}」？`)) return;
      try {
        await deleteDoc(doc(db, "budget_proposals", prop.id));
      } catch (e) {
        console.error(e);
        alert("刪除失敗");
      }
    },
    // [New] 結案釋出
    async closeProposal(prop) {
      if (!this.canManage(prop)) return alert("權限不足");
      const actual = prop.actualTotal || 0;
      const savedAmount = prop.amount - actual;
      let confirmMsg = `確定要結案「${
        prop.title
      }」嗎？\n\n・原始規劃: $${this.formatCurrency(
        prop.amount
      )}\n・實際核銷: $${this.formatCurrency(actual)}\n`;
      if (savedAmount >= 0) {
        confirmMsg += `\n💰 系統將釋出 $${this.formatCurrency(
          savedAmount
        )} 回預算池。`;
      } else {
        confirmMsg += `\n⚠️ 此專案超支 $${this.formatCurrency(
          Math.abs(savedAmount)
        )}，結案後將確認此超支金額。`;
      }
      confirmMsg += `\n\n(注意：結案後內容將無法再修改)`;
      if (!confirm(confirmMsg)) return;
      try {
        await updateDoc(doc(db, "budget_proposals", prop.id), {
          isClosed: true,
          originalAmount: prop.amount,
          amount: actual,
        });
        this.triggerConfetti();
      } catch (e) {
        console.error(e);
        alert("結案失敗");
      }
    },

    openSubItemModal(prop, subToEdit = null) {
      this.currentProposalForAdd = prop;
      if (subToEdit) {
        this.isEditingSubItem = true;
        this.currentSubItemEditId = subToEdit.id;
        this.subItemForm.name = subToEdit.name;
        this.subItemForm.amount = subToEdit.amount;
      } else {
        this.isEditingSubItem = false;
        this.currentSubItemEditId = null;
        this.subItemForm = { name: "", amount: 0 };
      }
      this.showSubItemModal = true;
    },
    async saveSubItem() {
      if (!this.subItemForm.name) return;
      let overReason = "";
      if (!this.isEditingSubItem && this.currentProposalForAdd) {
        const prop = this.currentProposalForAdd;
        const currentSubs = this.budgetSubItems
          .filter((s) => s.proposalId === prop.id)
          .reduce((s, i) => s + i.amount, 0);
        const remaining = prop.amount - currentSubs;
        if (this.subItemForm.amount > remaining) {
          const reason = prompt(
            `⚠️ [超支警示]\n\n此細項金額 ($${this.formatCurrency(
              this.subItemForm.amount
            )}) 已超過簽呈剩餘額度 ($${this.formatCurrency(
              remaining
            )})！\n\n請輸入「超支理由」以強制建立：`
          );
          if (reason === null) return;
          if (!reason.trim()) return alert("必須填寫理由才能超支！");
          overReason = reason;
        }
      }
      this.isSubmitting = true;
      try {
        if (this.isEditingSubItem) {
          await updateDoc(
            doc(db, "budget_sub_items", this.currentSubItemEditId),
            {
              name: this.subItemForm.name,
              amount: Number(this.subItemForm.amount) || 0,
            }
          );
        } else {
          const newData = {
            ...BudgetFactory.createSubItem(
              this.subItemForm,
              this.currentProposalForAdd.id,
              this.currentUser
            ),
            overspendReason: overReason,
          };
          await addDoc(collection(db, "budget_sub_items"), newData);
        }
        this.showSubItemModal = false;
      } catch (e) {
        console.error(e);
        alert("儲存失敗: " + e.message);
      } finally {
        this.isSubmitting = false;
      }
    },
    async deleteSubItem(sub) {
      if (!this.canManage(sub)) return alert("權限不足");
      if (!confirm(`確定刪除細項「${sub.name}」？`)) return;
      try {
        await deleteDoc(doc(db, "budget_sub_items", sub.id));
      } catch (e) {
        console.error(e);
        alert("刪除失敗");
      }
    },

    openExpenseModal(prop, sub, expenseToEdit = null) {
      this.currentSubItemForExpense = sub;
      if (expenseToEdit) {
        this.isEditingExpense = true;
        this.currentExpenseEditId = expenseToEdit.id;
        this.expenseForm = JSON.parse(JSON.stringify(expenseToEdit));
      } else {
        this.isEditingExpense = false;
        this.currentExpenseEditId = null;
        this.expenseForm = {
          event: "",
          vendor: "",
          invoiceNo: "",
          invoiceDate: new Date().toISOString().split("T")[0],
          amount: 0,
          isRequested: false,
          paymentDate: "",
          owner: this.currentUser.name,
        };
      }
      this.showExpenseModal = true;
    },
    async saveExpense() {
      if (!this.expenseForm.vendor || this.expenseForm.amount <= 0)
        return alert("請填寫完整資訊");
      this.isSubmitting = true;
      try {
        const dataToSave = {
          event: this.expenseForm.event || "",
          vendor: this.expenseForm.vendor,
          invoiceNo: this.expenseForm.invoiceNo,
          invoiceDate: this.expenseForm.invoiceDate,
          amount: Number(this.expenseForm.amount),
          isRequested: this.expenseForm.isRequested,
          paymentDate: this.expenseForm.paymentDate,
        };
        if (this.isEditingExpense) {
          const orgExp = this.budgetExpenses.find(
            (e) => e.id === this.currentExpenseEditId
          );
          if (
            orgExp.owner !== this.currentUser.name &&
            this.currentUser.role !== "admin"
          ) {
            throw new Error("只有本人或管理員可修改核銷單");
          }
          await updateDoc(
            doc(db, "budget_expenses", this.currentExpenseEditId),
            dataToSave
          );
        } else {
          const newData = {
            ...BudgetFactory.createExpense(
              this.expenseForm,
              this.currentSubItemForExpense.id,
              this.currentUser
            ),
            ...dataToSave,
          };
          await addDoc(collection(db, "budget_expenses"), newData);
        }
        this.showExpenseModal = false;
      } catch (e) {
        console.error(e);
        alert(e.message || "儲存失敗");
      } finally {
        this.isSubmitting = false;
      }
    },
    async deleteExpense(id) {
      if (!confirm("確定刪除此核銷紀錄？")) return;
      const orgExp = this.budgetExpenses.find((e) => e.id === id);
      if (
        orgExp.owner !== this.currentUser.name &&
        this.currentUser.role !== "admin"
      ) {
        return alert("只有本人或管理員可刪除");
      }
      try {
        await deleteDoc(doc(db, "budget_expenses", id));
      } catch (e) {
        console.error(e);
        alert("刪除失敗");
      }
    },
  },
});
app.use(router);
app.component("vuedraggable", window.vuedraggable);
app.mount("#app");
