(function () {
  const config = window.__TEAMAGENTS_CONFIG__ || {
    apiBase: "http://localhost:8080",
    wsUrl: "ws://localhost:8080/ws",
  };

  const app = document.getElementById("app");
  const state = {
    route: parseRoute(location.pathname),
    token: localStorage.getItem("ta_token") || "",
    authStep: "email",
    loginEmail: "",
    loginOtp: "",
    loading: false,
    error: "",
    toast: "",
    workspaces: [],
    currentWorkspace: null,
    issues: [],
    agents: [],
    skills: [],
    autopilots: [],
    runtimes: [],
    search: "",
    modal: null,
    ws: null,
    wsWorkspace: "",
  };

  const providerMeta = {
    claude: { label: "Claude", mark: "CL" },
    codex: { label: "Codex", mark: "CX" },
    "cursor-agent": { label: "Cursor Agent", mark: "CA" },
    copilot: { label: "Copilot", mark: "CP" },
    opencode: { label: "OpenCode", mark: "OC" },
    gemini: { label: "Gemini", mark: "GM" },
    kimi: { label: "Kimi", mark: "KM" },
  };

  const statusLabels = {
    open: "Open",
    in_progress: "In Progress",
    done: "Done",
  };

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

  function onClick(event) {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    event.preventDefault();
    const action = target.dataset.action;

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
    if (action === "skill-save") handleSaveSkill(form);
    if (action === "autopilot-create") handleCreateAutopilot(form);
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
    if (section === "issues") {
      state.issues = await api("GET", `/api/w/${ws}/issues`);
      state.agents = await api("GET", `/api/w/${ws}/agents`);
    }
    if (section === "agents") {
      state.agents = await api("GET", `/api/w/${ws}/agents`);
      state.runtimes = await api("GET", `/api/w/${ws}/runtimes`);
    }
    if (section === "skills") {
      state.skills = await api("GET", `/api/w/${ws}/skills`);
    }
    if (section === "autopilots") {
      state.autopilots = await api("GET", `/api/w/${ws}/autopilots`);
      state.agents = await api("GET", `/api/w/${ws}/agents`);
    }
    if (section === "settings") {
      state.runtimes = await api("GET", `/api/w/${ws}/runtimes`);
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
      });
      state.modal = null;
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
    state.modal = { type, id };
    render();
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
    if (!state.token || state.route.section !== "issues") {
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
        if (message.type === "issue:updated") {
          await loadWorkspaceSection();
        }
      } catch (_) {}
    };
    socket.onclose = function () {
      if (state.route.name === "workspace" && state.route.section === "issues") {
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
    console.error(error);
    if (String(error.message || "").toLowerCase().includes("token")) {
      localStorage.removeItem("ta_token");
      state.token = "";
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
          ${state.authStep === "email" ? `
            <form class="form-grid" data-form="login-email">
              <div class="field">
                <label>Email</label>
                <input class="input" data-model="login-email" name="email" type="email" value="${escapeAttr(state.loginEmail)}" placeholder="you@example.com" required>
              </div>
              <button class="btn" ${state.loading ? "disabled" : ""}>${state.loading ? "Sending..." : "Send OTP"}</button>
            </form>
          ` : `
            <form class="form-grid" data-form="login-otp">
              <input type="hidden" name="email" value="${escapeAttr(state.loginEmail)}">
              <div class="field">
                <label>OTP for ${escapeHtml(state.loginEmail)}</label>
                <input class="input" data-model="login-otp" name="code" value="${escapeAttr(state.loginOtp)}" placeholder="000000" maxlength="6" required>
              </div>
              <div class="button-row">
                <button class="btn" ${state.loading ? "disabled" : ""}>${state.loading ? "Verifying..." : "Verify OTP"}</button>
                <button class="btn btn-secondary" type="button" data-action="back-to-email">Change email</button>
              </div>
            </form>
          `}
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
      <a class="workspace-card" href="/dashboard/${workspace.slug}" data-action="navigate" data-href="/dashboard/${workspace.slug}">
        <div class="workspace-pill">
          <div class="workspace-mark">${escapeHtml(initials(workspace.name))}</div>
          <div>
            <h2 class="section-title">${escapeHtml(workspace.name)}</h2>
            <p class="subtitle">/${escapeHtml(workspace.slug)}</p>
          </div>
        </div>
      </a>
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
          ${renderWorkspaceSection(section)}
          ${renderModal()}
        </main>
      </div>
    `;
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

  function renderIssues() {
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
                <span class="muted mini">${state.issues.filter((item) => item.status === status).length}</span>
              </div>
              ${(state.issues.filter((item) => item.status === status).map(renderIssueCard).join("")) || `<div class="empty"><p class="muted">No issues</p></div>`}
            </div>
          `).join("")}
        </div>
      </section>
    `;
  }

  function renderIssueCard(issue) {
    const agent = state.agents.find((item) => item.id === issue.assignee_agent_id);
    return `
      <article class="issue-card">
        <h3 class="section-title">${escapeHtml(issue.title)}</h3>
        <p class="subtitle">${escapeHtml(issue.body || "No description yet.")}</p>
        <div class="top-actions" style="margin-top:14px;">
          <span class="mini ${priorityClass(issue.priority)}">#${issue.number} ${escapeHtml(issue.priority)}</span>
          ${agent ? `<span class="badge ${agent.status}">${escapeHtml(providerMeta[agent.provider]?.mark || "AG")} ${escapeHtml(agent.name)}</span>` : ""}
        </div>
      </article>
    `;
  }

  function renderAgents() {
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
                  <span class="muted mini"> ${escapeHtml(runtime.status)} | ${escapeHtml((runtime.available_clis || []).join(", ") || "No CLIs")}</span>
                </div>
              `).join("")}
            </div>
          </div>
        ` : ""}
        <div class="grid-3">
          ${state.agents.length ? state.agents.map(renderAgentCard).join("") : `<div class="empty"><p class="muted">No agents yet.</p></div>`}
        </div>
      </section>
    `;
  }

  function renderAgentCard(agent) {
    const runtime = state.runtimes.find((item) => item.id === agent.runtime_id);
    return `
      <article class="agent-card">
        <div class="page-header" style="margin-bottom:10px;">
          <div>
            <h3 class="section-title">${escapeHtml(agent.name)}</h3>
            <p class="subtitle">${escapeHtml(providerMeta[agent.provider]?.label || agent.provider)}</p>
          </div>
          <div class="top-actions">
            <span class="badge ${agent.status}">${escapeHtml(agent.status)}</span>
            <button class="btn btn-danger mini" data-action="delete-agent" data-id="${agent.id}">Delete</button>
          </div>
        </div>
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
                  <p class="subtitle">${escapeHtml(runtime.hostname || "unknown host")} | ${escapeHtml((runtime.available_clis || []).join(", ") || "No CLIs")} | ${escapeHtml(runtime.status)}</p>
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
            <input class="input" name="slug" pattern="[a-z0-9-]{3,50}" required>
          </div>
          <div class="button-row">
            <button class="btn">Create</button>
            <button class="btn btn-secondary" type="button" data-action="close-modal">Cancel</button>
          </div>
        </form>
      `);
    }

    if (state.modal.type === "issue-create") {
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
              <select class="select" name="assignee_agent_id">
                <option value="">Unassigned</option>
                ${state.agents.map((agent) => `<option value="${agent.id}">${escapeHtml(agent.name)}</option>`).join("")}
              </select>
            </div>
          </div>
          <div class="button-row">
            <button class="btn">Create</button>
            <button class="btn btn-secondary" type="button" data-action="close-modal">Cancel</button>
          </div>
        </form>
      `);
    }

    if (state.modal.type === "agent-create") {
      return wrapModal(`
        <h3 class="section-title">Create agent</h3>
        ${state.error ? `<p class="error">${escapeHtml(state.error)}</p>` : ""}
        <form class="form-grid" data-form="agent-create">
          <div class="field"><label>Name</label><input class="input" name="name" required></div>
          <div class="grid-2">
            <div class="field">
              <label>Provider</label>
              <select class="select" name="provider">${Object.entries(providerMeta).map(([key, meta]) => `<option value="${key}">${escapeHtml(meta.label)}</option>`).join("")}</select>
            </div>
            <div class="field">
              <label>Runtime</label>
              <select class="select" name="runtime_id">
                <option value="">Unassigned</option>
                ${state.runtimes.map((runtime) => `<option value="${runtime.id}">${escapeHtml(runtime.name)}</option>`).join("")}
              </select>
            </div>
          </div>
          <div class="button-row">
            <button class="btn">Create</button>
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
      return wrapModal(`
        <h3 class="section-title">Create autopilot</h3>
        ${state.error ? `<p class="error">${escapeHtml(state.error)}</p>` : ""}
        <form class="form-grid" data-form="autopilot-create">
          <div class="field"><label>Name</label><input class="input" name="name" required></div>
          <div class="grid-2">
            <div class="field">
              <label>Agent</label>
              <select class="select" name="agent_id" required>
                <option value="">Select agent</option>
                ${state.agents.map((agent) => `<option value="${agent.id}">${escapeHtml(agent.name)}</option>`).join("")}
              </select>
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
