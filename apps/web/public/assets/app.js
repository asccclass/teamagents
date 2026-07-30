(function () {
  const defaultWsProtocol = location.protocol === "https:" ? "wss:" : "ws:";
  const rawConfig = window.__TEAMAGENTS_CONFIG__ || {};
  let apiBase = rawConfig.apiBase || "";
  if (location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
    if (apiBase.includes("localhost") || apiBase.includes("127.0.0.1")) {
      apiBase = "";
    }
  }
  let wsUrl = rawConfig.wsUrl;
  if (!wsUrl || ((location.hostname !== "localhost" && location.hostname !== "127.0.0.1") && (wsUrl.includes("localhost") || wsUrl.includes("127.0.0.1")))) {
    wsUrl = `${defaultWsProtocol}//${location.host}/ws`;
  }
  const config = { apiBase, wsUrl };

  // 捕捉由 MemAuth (https://auth.justdrink.com.tw/) 帶回的 token
  const urlParams = new URLSearchParams(location.search);
  const urlToken = urlParams.get("token");
  if (urlToken) {
    localStorage.setItem("ta_token", urlToken);
    urlParams.delete("token");
    const cleanSearch = urlParams.toString();
    const cleanUrl = location.pathname + (cleanSearch ? "?" + cleanSearch : "") + location.hash;
    history.replaceState({}, "", cleanUrl);
  }

  const app = document.getElementById("app");
  const state = {
    route: parseRoute(location.pathname),
    token: localStorage.getItem("ta_token") || "",
    authStep: "email",
    loginEmail: "",
    loginOtp: "",
    agentAvatarDataUrl: "",
    loading: false,
    error: "",
    toast: "",
    workspaces: [],
    currentWorkspace: null,
    issues: [],
    agents: [],
    tasks: [],
    taskProgress: {},
    taskCollapsePrefs: {},
    agentPickerValues: {},
    agentPickerSearches: {},
    selectedChatAgentId: "",
    chatDraft: "",
    chatThread: null,
    chatLoading: false,
    skills: [],
    autopilots: [],
    runtimes: [],
    search: "",
    modal: null,
    ws: null,
    wsWorkspace: "",
    collapsedTasks: {},
  };

  const providerMeta = {
    claude: { label: "Claude", mark: "CL" },
    codex: { label: "Codex", mark: "CX" },
    "cursor-agent": { label: "Cursor Agent", mark: "CA" },
    copilot: { label: "Copilot", mark: "CP" },
    llama: { label: "llama (HTTP)", mark: "LM" },
    "llama.cpp": { label: "llama.cpp", mark: "LL" },
    opencode: { label: "OpenCode", mark: "OC" },
    gemini: { label: "Gemini", mark: "GM" },
    kimi: { label: "Kimi", mark: "KM" },
  };

  const statusLabels = {
    open: "Open",
    in_progress: "In Progress",
    done: "Done",
  };

  const runtimeStatusLabels = {
    online: "Online",
    idle: "Idle",
    busy: "Busy",
    offline: "Offline",
  };

  function renderRuntimeStatus(status) {
    const normalized = (status || "offline").toLowerCase();
    const label = runtimeStatusLabels[normalized] || normalized.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
    return `<span class="runtime-status ${escapeAttr(normalized)}"><span class="runtime-status-light" aria-hidden="true"></span>${escapeHtml(label)}</span>`;
  }

  const priorityOptions = ["low", "medium", "high", "urgent"];

  document.addEventListener("click", onClick);
  document.addEventListener("submit", onSubmit);
  document.addEventListener("input", onInput);
  window.addEventListener("popstate", () => {
    state.route = parseRoute(location.pathname);
    render();
    hydrateRoute();
  });

  render();
  hydrateRoute();

  function parseRoute(pathname) {
    if (pathname === "/") return { name: "root" };
    if (pathname === "/login") return { name: "login" };
    if (pathname === "/dashboard") return { name: "dashboard" };
    const match = pathname.match(/^\/dashboard\/([^/]+)(?:\/([^/]+))?$/);
    if (match) {
      return {
        name: "workspace",
        workspace: decodeURIComponent(match[1]),
        section: match[2] || "issues",
      };
    }
    return { name: "not-found" };
  }

  function navigate(path, replace) {
    if (replace) {
      history.replaceState({}, "", path);
    } else {
      history.pushState({}, "", path);
    }
    state.route = parseRoute(path);
    render();
    hydrateRoute();
  }

  function setState(patch) {
    Object.assign(state, patch);
    render();
  }

  async function hydrateRoute() {
    if (state.route.name === "root") {
      navigate(state.token ? "/dashboard" : "/login", true);
      return;
    }

    if (state.route.name === "login" && state.token) {
      navigate("/dashboard", true);
      return;
    }

    if (!state.token && state.route.name !== "login") {
      navigate("/login", true);
      return;
    }

    if (state.route.name === "dashboard") {
      await loadWorkspaces();
      return;
    }

    if (state.route.name === "workspace") {
      await Promise.all([loadWorkspaces(), loadWorkspaceSection()]);
      connectWorkspaceSocket();
      return;
    }

    disconnectSocket();
  }

  function redirectToMemAuth() {
    const redirectTarget = location.origin + "/dashboard";
    window.location.href = `https://auth.justdrink.com.tw/authlogin?redirectURL=${encodeURIComponent(redirectTarget)}&redirect_uri=${encodeURIComponent(redirectTarget)}`;
  }

  function onClick(event) {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    event.preventDefault();
    const action = target.dataset.action;

    if (action === "login-memauth") {
      redirectToMemAuth();
      return;
    }
    if (action === "navigate") {
      navigate(target.dataset.href);
      return;
    }
    if (action === "logout") {
      localStorage.removeItem("ta_token");
      state.token = "";
      disconnectSocket();
      navigate("/login", true);
      return;
    }
    if (action === "open-modal") {
      openModal(target.dataset.modal, target.dataset.id || "");
      return;
    }
    if (action === "back-to-email") {
      state.authStep = "email";
      state.loginOtp = "";
      state.error = "";
      render();
      return;
    }
    if (action === "close-modal") {
      state.modal = null;
      state.error = "";
      state.toast = "";
      render();
      return;
    }
    if (action === "delete-agent") {
      handleDeleteAgent(target.dataset.id);
      return;
    }
    if (action === "edit-agent") {
      openModal("agent-edit", target.dataset.id);
      return;
    }
    if (action === "toggle-task-output") {
      toggleTaskOutput(target.dataset.id);
      return;
    }
    if (action === "select-chat-agent") {
      const nextId = target.dataset.id || "";
      state.selectedChatAgentId = state.selectedChatAgentId === nextId ? "" : nextId;
      render();
      loadSelectedChatThread();
      return;
    }
    if (action === "chat-clear-thread") {
      handleClearChatThread();
      return;
    }
    if (action === "chat-new-thread") {
      handleNewChatThread();
      return;
    }
    if (action === "copy-task-output") {
      copyTaskOutput(target.dataset.id);
      return;
    }
    if (action === "select-agent-option") {
      selectAgentOption(target.dataset.target, target.dataset.id || "");
      return;
    }
    if (action === "delete-issue") {
      handleDeleteIssue(target.dataset.id);
      return;
    }
    if (action === "delete-workspace") {
      handleDeleteWorkspace(target.dataset.slug);
      return;
    }
    if (action === "delete-skill") {
      handleDeleteSkill(target.dataset.id);
      return;
    }
    if (action === "toggle-skill") {
      toggleSkill(target.dataset.id);
      return;
    }
    if (action === "edit-skill") {
      openModal("skill-edit", target.dataset.id);
      return;
    }
    if (action === "toggle-autopilot") {
      handleToggleAutopilot(target.dataset.id);
      return;
    }
    if (action === "trigger-autopilot") {
      handleTriggerAutopilot(target.dataset.id);
      return;
    }
    if (action === "delete-autopilot") {
      handleDeleteAutopilot(target.dataset.id);
      return;
    }
    if (action === "copy-settings") {
      navigator.clipboard.writeText(buildDaemonEnv());
      state.toast = "Daemon env copied.";
      render();
      return;
    }
    if (action === "copy-webhook") {
      navigator.clipboard.writeText(target.dataset.value || "");
      state.toast = "Webhook URL copied.";
      render();
    }
  }

  function onInput(event) {
    const target = event.target;
    if (target.matches("[data-model='login-email']")) state.loginEmail = target.value;
    if (target.matches("[data-model='login-otp']")) state.loginOtp = target.value.replace(/\D/g, "").slice(0, 6);
    if (target.matches("[data-model='skill-search']")) {
      state.search = target.value;
      debounceSearch();
    }
    if (target.matches("[data-model='agent-avatar']")) {
      handleAgentAvatarInput(target);
    }
    if (target.matches("[data-model='agent-picker-search']")) {
      state.agentPickerSearches[target.dataset.target || ""] = target.value;
      render();
    }
    if (target.matches("[data-model='chat-draft']")) {
      state.chatDraft = target.value;
    }
  }

  function onSubmit(event) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    event.preventDefault();

    const action = form.dataset.form;
    if (action === "login-email") handleSendOtp(form);
    if (action === "login-otp") handleVerifyOtp(form);
    if (action === "workspace-create") handleCreateWorkspace(form);
    if (action === "issue-create") handleCreateIssue(form);
    if (action === "agent-create") handleCreateAgent(form);
    if (action === "agent-update") handleUpdateAgent(form);
    if (action === "skill-save") handleSaveSkill(form);
    if (action === "autopilot-create") handleCreateAutopilot(form);
    if (action === "chat-send") handleChatSend(form);
  }

  async function handleSendOtp(form) {
    const email = new FormData(form).get("email");
    state.loading = true;
    state.error = "";
    render();
    try {
      await api("POST", "/api/auth/send-otp", { email });
      state.authStep = "otp";
      state.loginEmail = String(email || "");
    } catch (error) {
      state.error = error.message;
    } finally {
      state.loading = false;
      render();
    }
  }

  async function handleVerifyOtp(form) {
    const data = new FormData(form);
    state.loading = true;
    state.error = "";
    render();
    try {
      const result = await api("POST", "/api/auth/verify-otp", {
        email: data.get("email"),
        code: data.get("code"),
      });
      state.token = result.token;
      localStorage.setItem("ta_token", result.token);
      state.authStep = "email";
      state.loginOtp = "";
      navigate("/dashboard", true);
    } catch (error) {
      state.error = error.message;
      state.loading = false;
      render();
    }
  }

  async function loadWorkspaces() {
    try {
      state.workspaces = await api("GET", "/api/workspaces");
      if (state.route.name === "workspace") {
        state.currentWorkspace = state.workspaces.find((item) => item.slug === state.route.workspace) || null;
      }
      render();
    } catch (error) {
      handleAuthFailure(error);
    }
  }

  async function loadWorkspaceSection() {
    const ws = state.route.workspace;
    const section = state.route.section || "issues";
    state.agents = await api("GET", `/api/w/${ws}/agents`);
    state.runtimes = await api("GET", `/api/w/${ws}/runtimes`);
    state.issues = await api("GET", `/api/w/${ws}/issues`);
    state.tasks = await api("GET", `/api/w/${ws}/tasks`);
    const knownTaskIds = new Set(state.tasks.map((item) => item.id));
    Object.keys(state.taskProgress).forEach((taskId) => {
      if (!knownTaskIds.has(taskId)) {
        delete state.taskProgress[taskId];
      }
    });
    Object.keys(state.taskCollapsePrefs).forEach((taskId) => {
      if (!knownTaskIds.has(taskId)) {
        delete state.taskCollapsePrefs[taskId];
      }
    });
    if (state.selectedChatAgentId && !state.agents.some((item) => item.id === state.selectedChatAgentId)) {
      state.selectedChatAgentId = "";
    }
    await loadSelectedChatThread();

    if (section === "issues") {
    }
    if (section === "agents") {
    }
    if (section === "skills") {
      state.skills = await api("GET", `/api/w/${ws}/skills`);
    }
    if (section === "autopilots") {
      state.autopilots = await api("GET", `/api/w/${ws}/autopilots`);
    }
    if (section === "settings") {
    }
    render();
  }

  async function handleCreateWorkspace(form) {
    const data = new FormData(form);
    try {
      const workspace = await api("POST", "/api/workspaces", {
        name: data.get("name"),
        slug: data.get("slug"),
      });
      state.modal = null;
      navigate(`/dashboard/${workspace.slug}`, true);
    } catch (error) {
      state.error = error.message;
      render();
    }
  }

  async function handleCreateIssue(form) {
    const ws = state.route.workspace;
    const data = new FormData(form);
    try {
      await api("POST", `/api/w/${ws}/issues`, {
        title: data.get("title"),
        body: data.get("body"),
        priority: data.get("priority"),
        assignee_agent_id: data.get("assignee_agent_id") || null,
      });
      state.modal = null;
      await loadWorkspaceSection();
    } catch (error) {
      state.error = error.message;
      render();
    }
  }

  async function handleCreateAgent(form) {
    const ws = state.route.workspace;
    const data = new FormData(form);
    try {
      await api("POST", `/api/w/${ws}/agents`, {
        name: data.get("name"),
        provider: data.get("provider"),
        runtime_id: data.get("runtime_id") || null,
        system_prompt: data.get("system_prompt") || "",
        avatar_url: state.agentAvatarDataUrl || "",
      });
      state.modal = null;
      state.agentAvatarDataUrl = "";
      await loadWorkspaceSection();
    } catch (error) {
      state.error = error.message;
      render();
    }
  }

  async function handleUpdateAgent(form) {
    const ws = state.route.workspace;
    const data = new FormData(form);
    try {
      await api("PUT", `/api/w/${ws}/agents/${state.modal.id}`, {
        name: data.get("name"),
        provider: data.get("provider"),
        runtime_id: data.get("runtime_id") || null,
        system_prompt: data.get("system_prompt") || "",
        avatar_url: state.agentAvatarDataUrl || "",
      });
      state.modal = null;
      state.agentAvatarDataUrl = "";
      await loadWorkspaceSection();
    } catch (error) {
      state.error = error.message;
      render();
    }
  }

  async function handleDeleteAgent(id) {
    if (!confirm("Delete this agent?")) return;
    await api("DELETE", `/api/w/${state.route.workspace}/agents/${id}`);
    await loadWorkspaceSection();
  }

  async function handleDeleteIssue(id) {
    if (!confirm("Delete this issue?")) return;
    await api("DELETE", `/api/w/${state.route.workspace}/issues/${id}`);
    await loadWorkspaceSection();
  }

  async function handleDeleteWorkspace(slug) {
    if (!slug) return;
    if (!confirm(`Delete workspace "${slug}"? This cannot be undone.`)) return;
    try {
      await api("DELETE", `/api/workspaces/${encodeURIComponent(slug)}`);
      state.toast = "Workspace deleted.";
      await loadWorkspaces();
      if (state.route.name === "workspace" && state.route.workspace === slug) {
        navigate("/dashboard", true);
      } else {
        render();
      }
    } catch (error) {
      state.error = error.message;
      render();
    }
  }

  async function handleSaveSkill(form) {
    const ws = state.route.workspace;
    const data = new FormData(form);
    const payload = {
      name: data.get("name"),
      description: data.get("description"),
      content: data.get("content"),
    };
    try {
      if (state.modal && state.modal.type === "skill-edit") {
        await api("PUT", `/api/w/${ws}/skills/${state.modal.id}`, payload);
      } else {
        await api("POST", `/api/w/${ws}/skills`, payload);
      }
      state.modal = null;
      await loadWorkspaceSection();
    } catch (error) {
      state.error = error.message;
      render();
    }
  }

  async function handleDeleteSkill(id) {
    if (!confirm("Delete this skill?")) return;
    await api("DELETE", `/api/w/${state.route.workspace}/skills/${id}`);
    await loadWorkspaceSection();
  }

  async function searchSkills() {
    if (!state.search.trim()) {
      await loadWorkspaceSection();
      return;
    }
    state.skills = await api("GET", `/api/w/${state.route.workspace}/skills/search?q=${encodeURIComponent(state.search.trim())}`);
    render();
  }

  async function handleCreateAutopilot(form) {
    const ws = state.route.workspace;
    const data = new FormData(form);
    const preset = String(data.get("cron_preset") || "@daily");
    const cronExpr = preset === "custom" ? String(data.get("cron_custom") || "") : preset;
    try {
      await api("POST", `/api/w/${ws}/autopilots`, {
        name: data.get("name"),
        agent_id: data.get("agent_id"),
        cron_expr: cronExpr || null,
        issue_template: {
          title: data.get("issue_title"),
          body: data.get("issue_body"),
          priority: data.get("issue_priority"),
        },
      });
      state.modal = null;
      await loadWorkspaceSection();
    } catch (error) {
      state.error = error.message;
      render();
    }
  }

  async function handleToggleAutopilot(id) {
    const autopilot = state.autopilots.find((item) => item.id === id);
    await api("PATCH", `/api/w/${state.route.workspace}/autopilots/${id}`, {
      enabled: !autopilot.enabled,
    });
    await loadWorkspaceSection();
  }

  async function handleTriggerAutopilot(id) {
    await api("POST", `/api/w/${state.route.workspace}/autopilots/${id}/trigger`);
    state.toast = "Autopilot triggered.";
    await loadWorkspaceSection();
  }

  async function handleDeleteAutopilot(id) {
    if (!confirm("Delete this autopilot?")) return;
    await api("DELETE", `/api/w/${state.route.workspace}/autopilots/${id}`);
    await loadWorkspaceSection();
  }

  function openModal(type, id) {
    state.error = "";
    state.toast = "";
    if (type === "agent-create") {
      state.agentAvatarDataUrl = "";
    }
    if (type === "agent-edit") {
      const agent = state.agents.find((item) => item.id === id);
      state.agentAvatarDataUrl = agent && agent.avatar_url ? agent.avatar_url : "";
    }
    if (type === "issue-create") {
      state.agentPickerValues.assignee_agent_id = "";
      state.agentPickerSearches.assignee_agent_id = "";
    }
    if (type === "autopilot-create") {
      state.agentPickerValues.agent_id = "";
      state.agentPickerSearches.agent_id = "";
    }
    state.modal = { type, id };
    render();
  }

  async function loadSelectedChatThread() {
    const ws = state.route.workspace;
    const agentId = state.selectedChatAgentId;
    if (!ws || !agentId) {
      state.chatThread = null;
      state.chatLoading = false;
      return;
    }
    state.chatThread = null;
    state.chatLoading = true;
    render();
    try {
      state.chatThread = await api("GET", `/api/w/${ws}/agents/${agentId}/chat`);
    } catch (error) {
      state.error = error.message;
      state.chatThread = null;
    } finally {
      state.chatLoading = false;
      render();
    }
  }

  async function handleChatSend(form) {
    const ws = state.route.workspace;
    const text = String(new FormData(form).get("message") || "").trim();
    const agentId = state.selectedChatAgentId;
    if (!agentId || !text) return;
    try {
      state.chatThread = await api("POST", `/api/w/${ws}/agents/${agentId}/chat`, {
        message: text,
      });
      state.chatDraft = "";
      await loadWorkspaceSection();
    } catch (error) {
      state.error = error.message;
      render();
    }
  }

  async function handleClearChatThread() {
    const ws = state.route.workspace;
    const agentId = state.selectedChatAgentId;
    if (!ws || !agentId) return;
    if (!confirm("Clear the current chat thread? This will remove its messages and tasks.")) return;
    try {
      state.chatThread = await api("DELETE", `/api/w/${ws}/agents/${agentId}/chat`);
      state.chatDraft = "";
      await loadWorkspaceSection();
    } catch (error) {
      state.error = error.message;
      render();
    }
  }

  async function handleNewChatThread() {
    const ws = state.route.workspace;
    const agentId = state.selectedChatAgentId;
    if (!ws || !agentId) return;
    if (!confirm("Start a new chat thread with this agent? The current thread will be archived.")) return;
    try {
      state.chatThread = await api("POST", `/api/w/${ws}/agents/${agentId}/chat/new`, {});
      state.chatDraft = "";
      await loadWorkspaceSection();
    } catch (error) {
      state.error = error.message;
      render();
    }
  }

  async function handleAgentAvatarInput(input) {
    const file = input.files && input.files[0];
    if (!file) {
      state.agentAvatarDataUrl = "";
      render();
      return;
    }
    try {
      state.agentAvatarDataUrl = await readFileAsDataUrl(file);
      render();
    } catch (_) {
      state.error = "Failed to read avatar file.";
      render();
    }
  }

  function toggleSkill(id) {
    if (!state.modal || state.modal.id !== id || state.modal.type !== "skill-view") {
      state.modal = { type: "skill-view", id };
    } else {
      state.modal = null;
    }
    render();
  }

  function connectWorkspaceSocket() {
    const wsName = state.route.workspace;
    if (!state.token || state.route.name !== "workspace") {
      disconnectSocket();
      return;
    }
    if (state.ws && state.wsWorkspace === wsName) return;
    disconnectSocket();
    const socket = new WebSocket(`${config.wsUrl}?token=${encodeURIComponent(state.token)}&workspace=${encodeURIComponent(wsName)}`);
    state.ws = socket;
    state.wsWorkspace = wsName;
    socket.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === "task:progress") {
          const taskId = message.payload && message.payload.task_id;
          const line = message.payload && message.payload.line;
          if (taskId && typeof line === "string") {
            state.taskProgress[taskId] = (state.taskProgress[taskId] || "") + line;
            render();
            return;
          }
        }
        if (message.type === "task:status") {
          const taskId = message.payload && message.payload.task_id;
          const status = message.payload && message.payload.status;
          if (taskId && status && ["done", "failed", "cancelled"].includes(String(status))) {
            delete state.taskProgress[taskId];
          }
        }
        if (message.type === "chat:updated") {
          await loadSelectedChatThread();
          return;
        }
        if (message.type === "issue:updated" || message.type === "task:status") {
          await loadWorkspaceSection();
        }
      } catch (_) {}
    };
    socket.onclose = function () {
      if (state.route.name === "workspace") {
        setTimeout(connectWorkspaceSocket, 2500);
      }
    };
  }

  function disconnectSocket() {
    if (state.ws) {
      state.ws.close();
      state.ws = null;
      state.wsWorkspace = "";
    }
  }

  async function api(method, path, body) {
    const response = await fetch(config.apiBase + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(payload.error || payload.message || "Request failed.");
    }
    if (response.status === 204) return null;
    const payload = await response.json().catch(() => ({}));
    return payload.data || payload;
  }

  function handleAuthFailure(error) {
    console.error("Auth Failure:", error);
    const msg = String(error.message || "");
    if (msg.toLowerCase().includes("token") || msg.toLowerCase().includes("unauthorized") || msg.toLowerCase().includes("無效") || msg.toLowerCase().includes("過期")) {
      localStorage.removeItem("ta_token");
      state.token = "";
      state.error = `認證失敗: ${msg}`;
      navigate("/login", true);
    }
  }

  let searchTimer = null;
  function debounceSearch() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(searchSkills, 280);
  }

  function buildDaemonEnv() {
    const base = config.apiBase;
    return [
      "# .env for TeamAgents Daemon",
      `DAEMON_TOKEN=${state.token}`,
      `WORKSPACE_SLUG=${state.route.workspace || ""}`,
      `API_BASE=${base}`,
      `WS_URL=${config.wsUrl}`,
      "AGENT_WORKDIR=/path/to/your/project",
      "# Optional for llama.cpp agents",
      "LLAMA_MODEL=C:\\llama.cpp\\models\\your-model.gguf",
      "LLAMA_CTX=4096",
      "LLAMA_NGL=999",
      "LLAMA_EXTRA_ARGS=",
    ].join("\n");
  }

  function render() {
    app.innerHTML = layoutForRoute();
    document.title = state.route.name === "workspace"
      ? `TeamAgents - ${state.route.workspace}`
      : "TeamAgents";
  }

  function layoutForRoute() {
    if (state.route.name === "login" || state.route.name === "root") return renderLogin();
    if (state.route.name === "dashboard") return renderDashboard();
    if (state.route.name === "workspace") return renderWorkspace();
    return `<div class="center"><div class="empty"><h1 class="title">Page not found</h1></div></div>`;
  }

  function renderLogin() {
    return `
      <div class="center">
        <section class="auth-card">
          <div class="brand-mark">TA</div>
          <h1 class="title">TeamAgents</h1>
          <p class="subtitle">AI Agents as Teammates</p>
          ${state.error ? `<p class="error">${escapeHtml(state.error)}</p>` : ""}
          <div class="form-grid" style="margin-top:24px;">
            <button class="btn" type="button" data-action="login-memauth">使用 MemAuth 帳號登入</button>
            <p class="muted mini" style="text-align:center;margin-top:8px;">單點登入系統：auth.justdrink.com.tw</p>
          </div>
          ${renderModal()}
        </section>
      </div>
    `;
  }

  function renderDashboard() {
    return `
      <div class="shell page">
        <div class="page-header">
          <div>
            <h1 class="title">Workspaces</h1>
            <p class="subtitle">Pick a workspace or create a new one.</p>
          </div>
          <div class="top-actions">
            <button class="btn" data-action="open-modal" data-modal="workspace-create">New Workspace</button>
            <button class="btn btn-secondary" data-action="logout">Logout</button>
          </div>
        </div>
        <div class="workspace-list">
          ${state.workspaces.length ? state.workspaces.map(renderWorkspaceCard).join("") : `
            <div class="empty">
              <h2 class="section-title">No workspaces yet</h2>
              <p class="subtitle">Create your first workspace to start coordinating agents.</p>
            </div>
          `}
        </div>
        ${renderModal()}
      </div>
    `;
  }

  function renderWorkspaceCard(workspace) {
    return `
      <article class="workspace-card">
        <a class="workspace-pill" href="/dashboard/${workspace.slug}" data-action="navigate" data-href="/dashboard/${workspace.slug}">
          <div class="workspace-mark">${escapeHtml(initials(workspace.name))}</div>
          <div>
            <h2 class="section-title">${escapeHtml(workspace.name)}</h2>
            <p class="subtitle">/${escapeHtml(workspace.slug)}</p>
          </div>
        </a>
        <div class="top-actions" style="margin-top:12px;">
          <button class="btn btn-danger mini" data-action="delete-workspace" data-slug="${escapeAttr(workspace.slug)}">Delete</button>
        </div>
      </article>
    `;
  }

  function renderWorkspace() {
    const section = state.route.section || "issues";
    return `
      <div class="app-layout">
        <aside class="sidebar stack">
          <div class="sidebar-head">
            <button class="btn btn-secondary mini" data-action="navigate" data-href="/dashboard">Back to workspaces</button>
            <div class="workspace-pill" style="margin-top:12px;">
              <div class="workspace-mark">${escapeHtml(initials(state.route.workspace))}</div>
              <div>
                <div>${escapeHtml(state.currentWorkspace ? state.currentWorkspace.name : state.route.workspace)}</div>
                <div class="muted mini">/${escapeHtml(state.route.workspace)}</div>
              </div>
            </div>
          </div>
          <nav class="sidebar-nav">
            ${renderNavLink("issues", "Issues", section)}
            ${renderNavLink("agents", "Agents", section)}
            ${renderNavLink("skills", "Skills", section)}
            ${renderNavLink("autopilots", "Autopilots", section)}
            ${renderNavLink("settings", "Settings", section)}
          </nav>
          <div class="sidebar-footer">
            <button class="btn btn-secondary" data-action="logout">Logout</button>
          </div>
        </aside>
        <main class="page">
          ${state.toast ? `<p class="success">${escapeHtml(state.toast)}</p>` : ""}
          ${renderAgentChatDock()}
          <div class="workspace-main ${state.selectedChatAgentId ? "chat-open" : ""}">
            <div class="workspace-content">
              ${renderWorkspaceSection(section)}
            </div>
            ${renderAgentChatSidebar()}
          </div>
          ${renderModal()}
        </main>
      </div>
    `;
  }

  function renderAgentChatDock() {
    const agents = sortedAgents(state.agents);
    if (!agents.length) return "";
    return `
      <section class="panel chat-shell">
        <div class="chat-agent-strip">
          ${agents.map((agent) => `
            <button class="chat-agent-tab ${agent.id === state.selectedChatAgentId ? "active" : ""}" data-action="select-chat-agent" data-id="${escapeAttr(agent.id)}">
              ${renderAgentAvatar(agent, { size: "lg", online: isAgentOnline(agent) })}
              <span class="mini">${escapeHtml(agent.name)}</span>
            </button>
          `).join("")}
        </div>
      </section>
    `;
  }

  function renderAgentChatSidebar() {
    const agents = sortedAgents(state.agents);
    const selectedAgent = agents.find((item) => item.id === state.selectedChatAgentId) || null;
    if (!selectedAgent) return "";
    return renderAgentChatPanel(selectedAgent);
  }

  function renderAgentChatPanel(agent) {
    const messages = chatMessagesForAgent(agent.id);
    return `
      <aside class="chat-panel">
        <div class="page-header" style="margin-bottom:14px;">
          <div class="agent-heading">
            ${renderAgentAvatar(agent, { size: "lg", online: isAgentOnline(agent) })}
            <div>
              <h3 class="section-title">${escapeHtml(agent.name)}</h3>
              <p class="subtitle">${escapeHtml(providerMeta[agent.provider]?.label || agent.provider)}</p>
            </div>
          </div>
          <div class="top-actions">
            <button class="btn btn-secondary mini" type="button" data-action="select-chat-agent" data-id="${escapeAttr(agent.id)}">Close</button>
            <button class="btn btn-secondary mini" type="button" data-action="chat-new-thread">New thread</button>
            <button class="btn btn-secondary mini" type="button" data-action="chat-clear-thread" ${state.chatThread && state.chatThread.issue ? "" : "disabled"}>Clear chat</button>
          </div>
        </div>
        <div class="chat-transcript">
          ${state.chatLoading ? `<div class="empty"><p class="muted">Loading conversation...</p></div>` : ""}
          ${!state.chatLoading && messages.length ? messages.map(renderChatMessage).join("") : ""}
          ${!state.chatLoading && !messages.length ? `<div class="empty"><p class="muted">No messages yet. Start chatting with this agent.</p></div>` : ""}
        </div>
        <form class="chat-form" data-form="chat-send">
          <textarea class="textarea chat-input" data-model="chat-draft" name="message" placeholder="Type a message for this agent...">${escapeHtml(state.chatDraft)}</textarea>
          <div class="button-row">
            <button class="btn" type="submit">Send</button>
          </div>
        </form>
      </aside>
    `;
  }

  function chatMessagesForAgent(agentId) {
    if (agentId !== state.selectedChatAgentId || !state.chatThread) return [];
    const comments = Array.isArray(state.chatThread.comments) ? state.chatThread.comments : [];
    const pendingTasks = Array.isArray(state.chatThread.pending_tasks) ? state.chatThread.pending_tasks : [];
    const pendingByCommentId = {};
    pendingTasks.forEach((task) => {
      if (task.source_comment_id) pendingByCommentId[task.source_comment_id] = task;
    });

    const messages = comments.map((comment) => {
      const role = comment.author_agent_id ? "agent" : "user";
      return {
        id: comment.id,
        role,
        text: comment.body || "",
        createdAt: comment.created_at,
        status: null,
      };
    });

    comments.forEach((comment) => {
      if (comment.author_agent_id) return;
      const task = pendingByCommentId[comment.id];
      if (!task) return;
      const liveOutput = (state.taskProgress[task.id] || "").trim();
      messages.push({
        id: `pending-${task.id}`,
        role: "agent",
        text: liveOutput || pendingStatusLabel(task.status),
        createdAt: task.started_at || task.created_at,
        status: task.status || "queued",
      });
    });

    messages.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
    return messages;
  }

  function renderChatMessage(message) {
    return `
      <article class="chat-message ${escapeAttr(message.role)}">
        <div class="chat-message-meta">
          <span>${escapeHtml(message.role === "user" ? "You" : "Agent")}</span>
          <span class="muted mini">${escapeHtml(formatDateTime(message.createdAt) || "")}</span>
          ${message.status ? `<span class="badge ${escapeAttr(message.status)}">${escapeHtml(message.status)}</span>` : ""}
        </div>
        <div class="chat-bubble">${escapeHtml(message.text || "")}</div>
      </article>
    `;
  }

  function pendingStatusLabel(status) {
    if (status === "queued") return "Waiting for runtime...";
    if (status === "claimed") return "Task claimed by runtime...";
    if (status === "running") return "Thinking...";
    if (status === "failed") return "Task failed.";
    return "Working...";
  }

  function renderNavLink(section, label, activeSection) {
    const href = `/dashboard/${state.route.workspace}/${section}`;
    return `<a class="nav-link ${section === activeSection ? "active" : ""}" href="${href}" data-action="navigate" data-href="${href}">${label}</a>`;
  }

  function renderWorkspaceSection(section) {
    if (section === "issues") return renderIssues();
    if (section === "agents") return renderAgents();
    if (section === "skills") return renderSkills();
    if (section === "autopilots") return renderAutopilots();
    if (section === "settings") return renderSettings();
    return `<div class="empty">Unknown section</div>`;
  }

  function visibleIssues() {
    return state.issues.filter((item) => !Array.isArray(item.labels) || !item.labels.includes("chat-thread"));
  }

  function renderIssues() {
    const issues = visibleIssues();
    return `
      <section class="stack">
        <div class="page-header">
          <div>
            <h2>Issues</h2>
            <p class="subtitle">Plan, assign, and watch issue updates in real time.</p>
          </div>
          <button class="btn" data-action="open-modal" data-modal="issue-create">New Issue</button>
        </div>
        <div class="kanban">
          ${["open", "in_progress", "done"].map((status) => `
            <div class="kanban-column">
              <div class="column-head">
                <span class="badge ${status}">${statusLabels[status]}</span>
                <span class="muted mini">${issues.filter((item) => item.status === status).length}</span>
              </div>
              ${(issues.filter((item) => item.status === status).map(renderIssueCard).join("")) || `<div class="empty"><p class="muted">No issues</p></div>`}
            </div>
          `).join("")}
        </div>
      </section>
    `;
  }

  function renderIssueCard(issue) {
    const agent = state.agents.find((item) => item.id === issue.assignee_agent_id);
    const task = latestTaskForIssue(issue.id);
    return `
      <article class="issue-card">
        <div class="page-header" style="margin-bottom:10px;">
          <div>
            <h3 class="section-title">${escapeHtml(issue.title)}</h3>
            <p class="subtitle">${escapeHtml(issue.body || "No description yet.")}</p>
          </div>
          <button class="btn btn-danger mini" data-action="delete-issue" data-id="${issue.id}">Delete</button>
        </div>
        <div class="top-actions" style="margin-top:14px;">
          <span class="mini ${priorityClass(issue.priority)}">#${issue.number} ${escapeHtml(issue.priority)}</span>
          ${agent ? renderAgentPill(agent) : ""}
        </div>
        ${renderTaskResult(task)}
      </article>
    `;
  }

  function latestTaskForIssue(issueId) {
    const matches = state.tasks.filter((item) => item.issue_id === issueId);
    if (!matches.length) return null;
    return matches.reduce((latest, current) => {
      return new Date(current.created_at || 0) > new Date(latest.created_at || 0) ? current : latest;
    });
  }

  function renderTaskResult(task) {
    if (!task) {
      return `<div class="panel" style="margin-top:14px;"><p class="muted mini">No task has been created for this issue yet.</p></div>`;
    }

    const taskId = task.id;
    const liveOutput = state.taskProgress[task.id] || "";
    const output = (task.stdout_log || "").trim();
    const displayOutput = (liveOutput || output).trim();
    const error = (task.error_msg || "").trim();
    const startedAt = task.started_at ? formatDateTime(task.started_at) : "";
    const finishedAt = task.finished_at ? formatDateTime(task.finished_at) : "";
    const isCollapsed = getTaskCollapsed(task);
    const canCopy = !!displayOutput;

    return `
      <div class="panel" style="margin-top:14px;">
        <div class="top-actions" style="margin-bottom:10px;">
          <span class="badge ${escapeAttr(task.status || "queued")}">${escapeHtml(task.status || "queued")}</span>
          <span class="muted mini">${escapeHtml(providerMeta[task.provider]?.label || task.provider || "Unknown provider")}</span>
          ${typeof task.exit_code === "number" ? `<span class="muted mini">exit ${escapeHtml(String(task.exit_code))}</span>` : ""}
        </div>
        ${startedAt || finishedAt ? `<p class="muted mini">Started: ${escapeHtml(startedAt || "-")} | Finished: ${escapeHtml(finishedAt || "-")}</p>` : ""}
        ${liveOutput && task.status === "running" ? `<p class="muted mini">Streaming live output...</p>` : ""}
        ${displayOutput ? `
          <div class="top-actions" style="margin-top:10px;">
            <button class="btn btn-secondary mini" data-action="toggle-task-output" data-id="${escapeAttr(taskId)}">${isCollapsed ? "Expand output" : "Collapse output"}</button>
            <button class="btn btn-secondary mini" data-action="copy-task-output" data-id="${escapeAttr(taskId)}" ${canCopy ? "" : "disabled"}>Copy output</button>
          </div>
          ${isCollapsed ? `<p class="muted mini" style="margin-top:10px;">Output hidden.</p>` : `<pre class="code-block" style="margin-top:10px; white-space:pre-wrap;">${escapeHtml(displayOutput)}</pre>`}
        ` : ""}
        ${!displayOutput && task.status === "running" ? `<p class="muted mini">Task is running. Output will appear here.</p>` : ""}
        ${!output && task.status === "queued" ? `<p class="muted mini">Task is queued and waiting for a runtime.</p>` : ""}
        ${error ? `<p class="error" style="margin-top:10px;">${escapeHtml(error)}</p>` : ""}
      </div>
    `;
  }

  function toggleTaskOutput(taskId) {
    const task = state.tasks.find((item) => item.id === taskId);
    const nextValue = task ? !getTaskCollapsed(task) : !state.collapsedTasks[taskId];
    state.collapsedTasks[taskId] = nextValue;
    state.taskCollapsePrefs[taskId] = true;
    render();
  }

  async function copyTaskOutput(taskId) {
    const task = state.tasks.find((item) => item.id === taskId);
    if (!task) return;
    const text = (state.taskProgress[taskId] || task.stdout_log || "").trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      state.toast = "Task output copied.";
      render();
    } catch (_) {
      state.error = "Failed to copy task output.";
      render();
    }
  }

  function formatDateTime(value) {
    try {
      return new Date(value).toLocaleString();
    } catch (_) {
      return value || "";
    }
  }

  function getTaskCollapsed(task) {
    if (!task) return false;
    if (state.taskCollapsePrefs[task.id]) {
      return !!state.collapsedTasks[task.id];
    }
    return !["running", "claimed", "queued"].includes(String(task.status || "").toLowerCase());
  }

  function renderAgents() {
    const agents = sortedAgents(state.agents);
    return `
      <section class="stack">
        <div class="page-header">
          <div>
            <h2>Agents</h2>
            <p class="subtitle">Attach AI providers to runtimes and manage execution capacity.</p>
          </div>
          <button class="btn" data-action="open-modal" data-modal="agent-create">New Agent</button>
        </div>
        ${state.runtimes.length ? `
          <div class="panel">
            <h3 class="section-title">Runtimes</h3>
            <div class="runtime-wrap" style="margin-top:14px;">
              ${state.runtimes.map((runtime) => `
                <div class="runtime-chip">
                  <strong>${escapeHtml(runtime.name)}</strong>
                  <span class="muted mini">${renderRuntimeStatus(runtime.status)} | ${escapeHtml((runtime.available_clis || []).join(", ") || "No CLIs")}</span>
                </div>
              `).join("")}
            </div>
          </div>
        ` : ""}
        <div class="grid-3">
          ${agents.length ? agents.map(renderAgentCard).join("") : `<div class="empty"><p class="muted">No agents yet.</p></div>`}
        </div>
      </section>
    `;
  }

  function renderAgentCard(agent) {
    const runtime = state.runtimes.find((item) => item.id === agent.runtime_id);
    const online = isAgentOnline(agent);
    return `
      <article class="agent-card">
        <div class="page-header" style="margin-bottom:10px;">
          <div>
            <div class="agent-heading">
              ${renderAgentAvatar(agent, { size: "lg", online })}
              <div>
                <h3 class="section-title">${escapeHtml(agent.name)}</h3>
                <p class="subtitle">${escapeHtml(providerMeta[agent.provider]?.label || agent.provider)}</p>
              </div>
            </div>
          </div>
          <div class="top-actions">
            <span class="badge ${agent.status}">${escapeHtml(agent.status)}</span>
            <button class="btn btn-secondary mini" data-action="edit-agent" data-id="${agent.id}">Edit</button>
            <button class="btn btn-danger mini" data-action="delete-agent" data-id="${agent.id}">Delete</button>
          </div>
        </div>
        ${agent.system_prompt ? `<p class="muted mini">Prompt: ${escapeHtml(agent.system_prompt)}</p>` : ""}
        <p class="muted mini">Runtime: ${escapeHtml(runtime ? runtime.name : "Unassigned")}</p>
      </article>
    `;
  }

  function renderSkills() {
    return `
      <section class="stack">
        <div class="page-header">
          <div>
            <h2>Skills</h2>
            <p class="subtitle">Store reusable markdown instructions for your agents.</p>
          </div>
          <button class="btn" data-action="open-modal" data-modal="skill-create">New Skill</button>
        </div>
        <div class="toolbar">
          <input class="input search" data-model="skill-search" value="${escapeAttr(state.search)}" placeholder="Search skills...">
        </div>
        <div class="skill-list">
          ${state.skills.length ? state.skills.map((skill) => `
            <article class="skill-row">
              <div class="page-header" style="margin-bottom:10px;">
                <div>
                  <h3 class="section-title">${escapeHtml(skill.name)}</h3>
                  <p class="subtitle">${escapeHtml(skill.description || "No description.")}</p>
                </div>
                <div class="top-actions">
                  <button class="btn btn-secondary mini" data-action="toggle-skill" data-id="${skill.id}">View</button>
                  <button class="btn btn-secondary mini" data-action="edit-skill" data-id="${skill.id}">Edit</button>
                  <button class="btn btn-danger mini" data-action="delete-skill" data-id="${skill.id}">Delete</button>
                </div>
              </div>
            </article>
          `).join("") : `<div class="empty"><p class="muted">No skills found.</p></div>`}
        </div>
      </section>
    `;
  }

  function renderAutopilots() {
    return `
      <section class="stack">
        <div class="page-header">
          <div>
            <h2>Autopilots</h2>
            <p class="subtitle">Schedule recurring issue creation or trigger workflows by webhook.</p>
          </div>
          <button class="btn" data-action="open-modal" data-modal="autopilot-create">New Autopilot</button>
        </div>
        <div class="autopilot-list">
          ${state.autopilots.length ? state.autopilots.map((item) => renderAutopilotCard(item)).join("") : `
            <div class="empty"><p class="muted">No autopilots configured.</p></div>
          `}
        </div>
      </section>
    `;
  }

  function renderAutopilotCard(item) {
    const agent = state.agents.find((entry) => entry.id === item.agent_id);
    const webhook = `${config.apiBase}/api/w/${state.route.workspace}/autopilots/${item.id}/trigger`;
    return `
      <article class="autopilot-card">
        <div class="page-header" style="margin-bottom:12px;">
          <div>
            <h3 class="section-title">${escapeHtml(item.name)}</h3>
            <p class="subtitle">${escapeHtml(item.cron_expr || "Webhook trigger")} | ${escapeHtml(agent ? agent.name : "Unknown agent")}</p>
            ${agent ? `<div style="margin-top:8px;">${renderAgentPill(agent)}</div>` : ""}
          </div>
          <div class="top-actions">
            <span class="badge ${item.enabled ? "good" : "bad"}">${item.enabled ? "Enabled" : "Disabled"}</span>
            <button class="btn btn-secondary mini" data-action="trigger-autopilot" data-id="${item.id}">Trigger</button>
            <button class="btn btn-secondary mini" data-action="toggle-autopilot" data-id="${item.id}">${item.enabled ? "Pause" : "Enable"}</button>
            <button class="btn btn-danger mini" data-action="delete-autopilot" data-id="${item.id}">Delete</button>
          </div>
        </div>
        <div class="code-block">${escapeHtml(webhook)}</div>
        <div style="margin-top:10px;">
          <button class="btn btn-secondary mini" data-action="copy-webhook" data-value="${escapeAttr(webhook)}">Copy webhook URL</button>
        </div>
      </article>
    `;
  }

  function renderSettings() {
    return `
      <section class="stack">
        <div class="page-header">
          <div>
            <h2>Settings</h2>
            <p class="subtitle">Connect daemon runtimes with the current workspace token.</p>
          </div>
        </div>
        <div class="panel">
          <h3 class="section-title">Runtimes</h3>
          ${state.runtimes.length ? `
            <div class="stack" style="margin-top:14px;">
              ${state.runtimes.map((runtime) => `
                <div class="workspace-card">
                  <strong>${escapeHtml(runtime.name)}</strong>
                  <p class="subtitle">${escapeHtml(runtime.hostname || "unknown host")} | ${escapeHtml((runtime.available_clis || []).join(", ") || "No CLIs")} | ${renderRuntimeStatus(runtime.status)}</p>
                </div>
              `).join("")}
            </div>
          ` : `<p class="muted">No runtimes registered yet.</p>`}
        </div>
        <div class="panel">
          <div class="page-header">
            <div>
              <h3 class="section-title">Daemon env</h3>
              <p class="subtitle">Use this snippet on the machine that runs your coding agents.</p>
            </div>
            <button class="btn btn-secondary" data-action="copy-settings">Copy</button>
          </div>
          <pre class="code-block">${escapeHtml(buildDaemonEnv())}</pre>
        </div>
      </section>
    `;
  }

  function renderModal() {
    if (!state.modal) return "";

    if (state.modal.type === "workspace-create") {
      return wrapModal(`
        <h3 class="section-title">Create workspace</h3>
        ${state.error ? `<p class="error">${escapeHtml(state.error)}</p>` : ""}
        <form class="form-grid" data-form="workspace-create">
          <div class="field">
            <label>Name</label>
            <input class="input" name="name" required>
          </div>
          <div class="field">
            <label>Slug</label>
            <input class="input" name="slug" pattern="[a-z0-9\-]{3,50}" required>
          </div>
          <div class="button-row">
            <button class="btn">Create</button>
            <button class="btn btn-secondary" type="button" data-action="close-modal">Cancel</button>
          </div>
        </form>
      `);
    }

    if (state.modal.type === "issue-create") {
      const selectedAgentId = state.agentPickerValues.assignee_agent_id || "";
      return wrapModal(`
        <h3 class="section-title">Create issue</h3>
        ${state.error ? `<p class="error">${escapeHtml(state.error)}</p>` : ""}
        <form class="form-grid" data-form="issue-create">
          <div class="field"><label>Title</label><input class="input" name="title" required></div>
          <div class="field"><label>Body</label><textarea class="textarea" name="body"></textarea></div>
          <div class="grid-2">
            <div class="field">
              <label>Priority</label>
              <select class="select" name="priority">${priorityOptions.map((item) => `<option value="${item}">${item}</option>`).join("")}</select>
            </div>
            <div class="field">
              <label>Assign agent</label>
              <input type="hidden" name="assignee_agent_id" value="${escapeAttr(selectedAgentId)}">
              ${renderAgentPicker("assignee_agent_id", selectedAgentId, true)}
            </div>
          </div>
          <div class="button-row">
            <button class="btn">Create</button>
            <button class="btn btn-secondary" type="button" data-action="close-modal">Cancel</button>
          </div>
        </form>
      `);
    }

    if (state.modal.type === "agent-create" || state.modal.type === "agent-edit") {
      const agent = state.modal.type === "agent-edit"
        ? (state.agents.find((item) => item.id === state.modal.id) || { name: "", provider: "claude", runtime_id: "", system_prompt: "", avatar_url: "" })
        : { name: "", provider: "claude", runtime_id: "", system_prompt: "", avatar_url: "" };
      const avatarPreview = state.agentAvatarDataUrl || agent.avatar_url || "";
      return wrapModal(`
        <h3 class="section-title">${state.modal.type === "agent-edit" ? "Edit agent" : "Create agent"}</h3>
        ${state.error ? `<p class="error">${escapeHtml(state.error)}</p>` : ""}
        <form class="form-grid" data-form="${state.modal.type === "agent-edit" ? "agent-update" : "agent-create"}">
          <div class="agent-editor">
            ${renderAgentAvatar({ name: agent.name || "Agent", avatar_url: avatarPreview }, { size: "xl", online: false })}
            <div class="field">
              <label>Avatar</label>
              <input class="input" type="file" accept="image/*" data-model="agent-avatar">
              <p class="muted mini">Upload an image to identify this agent everywhere in the workspace.</p>
            </div>
          </div>
          <div class="field"><label>Name</label><input class="input" name="name" required value="${escapeAttr(agent.name || "")}"></div>
          <div class="grid-2">
            <div class="field">
              <label>Provider</label>
              <select class="select" name="provider">${Object.entries(providerMeta).map(([key, meta]) => `<option value="${key}" ${agent.provider === key ? "selected" : ""}>${escapeHtml(meta.label)}</option>`).join("")}</select>
            </div>
            <div class="field">
              <label>Runtime</label>
              <select class="select" name="runtime_id">
                <option value="">Unassigned</option>
                ${state.runtimes.map((runtime) => `<option value="${runtime.id}" ${agent.runtime_id === runtime.id ? "selected" : ""}>${escapeHtml(runtime.name)}</option>`).join("")}
              </select>
            </div>
          </div>
          <div class="field"><label>System prompt</label><textarea class="textarea" name="system_prompt">${escapeHtml(agent.system_prompt || "")}</textarea></div>
          <div class="button-row">
            <button class="btn">${state.modal.type === "agent-edit" ? "Save changes" : "Create"}</button>
            <button class="btn btn-secondary" type="button" data-action="close-modal">Cancel</button>
          </div>
        </form>
      `);
    }

    if (state.modal.type === "skill-create" || state.modal.type === "skill-edit") {
      const skill = state.skills.find((item) => item.id === state.modal.id) || { name: "", description: "", content: "" };
      return wrapModal(`
        <div class="modal-wide">
          <h3 class="section-title">${state.modal.type === "skill-edit" ? "Edit skill" : "Create skill"}</h3>
          ${state.error ? `<p class="error">${escapeHtml(state.error)}</p>` : ""}
          <form class="form-grid" data-form="skill-save">
            <div class="field"><label>Name</label><input class="input" name="name" required value="${escapeAttr(skill.name || "")}"></div>
            <div class="field"><label>Description</label><input class="input" name="description" value="${escapeAttr(skill.description || "")}"></div>
            <div class="field"><label>Markdown content</label><textarea class="textarea" name="content" required style="min-height:320px;">${escapeHtml(skill.content || "")}</textarea></div>
            <div class="button-row">
              <button class="btn">${state.modal.type === "skill-edit" ? "Save changes" : "Create"}</button>
              <button class="btn btn-secondary" type="button" data-action="close-modal">Cancel</button>
            </div>
          </form>
        </div>
      `);
    }

    if (state.modal.type === "skill-view") {
      const skill = state.skills.find((item) => item.id === state.modal.id);
      if (!skill) return "";
      return wrapModal(`
        <div class="modal-wide">
          <div class="page-header">
            <div>
              <h3 class="section-title">${escapeHtml(skill.name)}</h3>
              <p class="subtitle">${escapeHtml(skill.description || "")}</p>
            </div>
            <button class="btn btn-secondary" type="button" data-action="close-modal">Close</button>
          </div>
          <pre class="code-block">${escapeHtml(skill.content)}</pre>
        </div>
      `);
    }

    if (state.modal.type === "autopilot-create") {
      const selectedAgentId = state.agentPickerValues.agent_id || "";
      return wrapModal(`
        <h3 class="section-title">Create autopilot</h3>
        ${state.error ? `<p class="error">${escapeHtml(state.error)}</p>` : ""}
        <form class="form-grid" data-form="autopilot-create">
          <div class="field"><label>Name</label><input class="input" name="name" required></div>
          <div class="grid-2">
            <div class="field">
              <label>Agent</label>
              <input type="hidden" name="agent_id" value="${escapeAttr(selectedAgentId)}" required>
              ${renderAgentPicker("agent_id", selectedAgentId, false)}
            </div>
            <div class="field">
              <label>Cron preset</label>
              <select class="select" name="cron_preset">
                <option value="@hourly">@hourly</option>
                <option value="@daily" selected>@daily</option>
                <option value="@weekly">@weekly</option>
                <option value="@every 30m">@every 30m</option>
                <option value="@every 6h">@every 6h</option>
                <option value="custom">custom</option>
              </select>
            </div>
          </div>
          <div class="field"><label>Custom cron</label><input class="input" name="cron_custom" placeholder="@every 2h"></div>
          <div class="field"><label>Issue title</label><input class="input" name="issue_title"></div>
          <div class="field"><label>Issue body</label><textarea class="textarea" name="issue_body"></textarea></div>
          <div class="field">
            <label>Issue priority</label>
            <select class="select" name="issue_priority">${priorityOptions.map((item) => `<option value="${item}">${item}</option>`).join("")}</select>
          </div>
          <div class="button-row">
            <button class="btn">Create</button>
            <button class="btn btn-secondary" type="button" data-action="close-modal">Cancel</button>
          </div>
        </form>
      `);
    }

    return "";
  }

  function wrapModal(content) {
    return `<div class="modal-backdrop"><section class="modal">${content}</section></div>`;
  }

  function renderAgentAvatar(agent, options) {
    const size = options && options.size ? options.size : "sm";
    const online = !!(options && options.online);
    const avatarUrl = agent && agent.avatar_url ? agent.avatar_url : "";
    const fallback = initials(agent && agent.name ? agent.name : "AG");
    return `
      <span class="agent-avatar ${escapeAttr(size)}">
        ${avatarUrl ? `<img src="${escapeAttr(avatarUrl)}" alt="${escapeAttr(agent && agent.name ? agent.name : "Agent")}">` : `<span>${escapeHtml(fallback)}</span>`}
        ${online ? `<span class="agent-online-dot" aria-hidden="true"></span>` : ""}
      </span>
    `;
  }

  function renderAgentPill(agent) {
    return `
      <span class="agent-pill">
        ${renderAgentAvatar(agent, { size: "sm", online: isAgentOnline(agent) })}
        <span class="badge ${escapeAttr(agent.status || "idle")}">${escapeHtml(providerMeta[agent.provider]?.mark || "AG")} ${escapeHtml(agent.name)}</span>
      </span>
    `;
  }

  function renderAgentPicker(targetName, selectedId, allowEmpty) {
    const agents = sortedAgents(state.agents);
    const selected = selectedId || "";
    const selectedAgent = agents.find((agent) => agent.id === selected);
    const keyword = String(state.agentPickerSearches[targetName] || "").trim().toLowerCase();
    const filteredAgents = keyword
      ? agents.filter((agent) => String(agent.name || "").toLowerCase().includes(keyword))
      : agents;
    return `
      <details class="agent-select">
        <summary class="agent-select-trigger">
          ${selectedAgent ? `
            ${renderAgentAvatar(selectedAgent, { size: "sm", online: isAgentOnline(selectedAgent) })}
            <span>${escapeHtml(selectedAgent.name)}</span>
          ` : `
            <span class="agent-avatar sm"><span>NA</span></span>
            <span>${allowEmpty ? "Unassigned" : "Select agent"}</span>
          `}
        </summary>
        <div class="agent-select-menu">
          <input class="input agent-select-search" data-model="agent-picker-search" data-target="${escapeAttr(targetName)}" value="${escapeAttr(state.agentPickerSearches[targetName] || "")}" placeholder="Search agent...">
          ${allowEmpty ? `
            <button type="button" class="agent-option ${selected === "" ? "selected" : ""}" data-action="select-agent-option" data-target="${escapeAttr(targetName)}" data-id="">
              <span class="agent-avatar sm"><span>NA</span></span>
              <span>Unassigned</span>
            </button>
          ` : ""}
          ${filteredAgents.map((agent) => `
            <button type="button" class="agent-option ${selected === agent.id ? "selected" : ""}" data-action="select-agent-option" data-target="${escapeAttr(targetName)}" data-id="${escapeAttr(agent.id)}">
              ${renderAgentAvatar(agent, { size: "sm", online: isAgentOnline(agent) })}
              <span>${escapeHtml(agent.name)}</span>
            </button>
          `).join("")}
          ${!filteredAgents.length ? `<p class="muted mini">No agents match "${escapeHtml(state.agentPickerSearches[targetName] || "")}".</p>` : ""}
        </div>
      </details>
    `;
  }

  function selectAgentOption(targetName, id) {
    state.agentPickerValues[targetName] = id;
    const input = document.querySelector(`input[name="${targetName}"]`);
    if (input) {
      input.value = id;
      const field = input.closest(".field");
      if (field) {
        field.querySelectorAll(".agent-option").forEach((node) => {
          node.classList.toggle("selected", (node.dataset.id || "") === id);
        });
        const details = field.querySelector(".agent-select");
        if (details) details.open = false;
      }
    }
    render();
  }

  function isAgentOnline(agent) {
    const runtime = state.runtimes.find((item) => item.id === agent.runtime_id);
    return !!runtime && ["online", "idle", "busy"].includes(String(runtime.status || "").toLowerCase());
  }

  function sortedAgents(list) {
    const rank = { online: 0, idle: 0, busy: 1, offline: 2 };
    return [...(list || [])].sort((a, b) => {
      const aRank = rank[getAgentRuntimeStatus(a)] ?? 3;
      const bRank = rank[getAgentRuntimeStatus(b)] ?? 3;
      if (aRank !== bRank) return aRank - bRank;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
  }

  function getAgentRuntimeStatus(agent) {
    const runtime = state.runtimes.find((item) => item.id === agent.runtime_id);
    return String(runtime && runtime.status ? runtime.status : "offline").toLowerCase();
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function initials(value) {
    return String(value || "?").slice(0, 2).toUpperCase();
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function escapeAttr(value) {
    return escapeHtml(value).replaceAll("'", "&#39;");
  }

  function priorityClass(priority) {
    return `priority-${priority || "medium"}`;
  }
})();
