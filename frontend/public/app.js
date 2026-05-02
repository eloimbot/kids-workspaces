const loginView = document.querySelector("#login-view");
const dashboardView = document.querySelector("#dashboard-view");
const loginForm = document.querySelector("#login-form");
const loginError = document.querySelector("#login-error");
const logoutButton = document.querySelector("#logout-button");
const simpleLogoutButton = document.querySelector("#simple-logout-button");
const userModal = document.querySelector("#user-modal");
const templateModal = document.querySelector("#template-modal");
const userForm = document.querySelector("#user-form");
const userFormError = document.querySelector("#user-form-error");
const templateFormError = document.querySelector("#template-form-error");
const openUserModalButton = document.querySelector("#open-user-modal");
const openTemplateModalButton = document.querySelector("#open-template-modal");
const closeUserModalButton = document.querySelector("#close-user-modal");
const closeTemplateModalButton = document.querySelector("#close-template-modal");
const storeSearchInput = document.querySelector("#store-search-input");

const templatesRoot = document.querySelector("#templates");
const sessionsRoot = document.querySelector("#sessions");
const usersRoot = document.querySelector("#users-list");
const storeRoot = document.querySelector("#store-grid");
const templateCard = document.querySelector("#template-card");
const sessionCard = document.querySelector("#session-card");
const userCard = document.querySelector("#user-card");
const storeCard = document.querySelector("#store-card");
const searchInput = document.querySelector("#search-input");

const healthState = document.querySelector("#health-state");
const healthCopy = document.querySelector("#health-copy");
const templateCount = document.querySelector("#template-count");
const sessionCount = document.querySelector("#session-count");
const publicMode = document.querySelector("#public-mode");
const currentUserName = document.querySelector("#current-user-name");
const currentUserRole = document.querySelector("#current-user-role");
const usersSection = document.querySelector("#users-section");
const adminHero = document.querySelector("#admin-hero");
const standardHome = document.querySelector("#standard-home");
const standardTemplateCount = document.querySelector("#standard-template-count");
const standardSessionCount = document.querySelector("#standard-session-count");

const state = {
  currentUser: null,
  templates: [],
  sessions: [],
  users: [],
  storeItems: [],
  health: null,
  query: "",
  storeQuery: "",
};

async function request(url, options) {
  const response = await fetch(url, options);

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const error = new Error(payload.error || `Request failed: ${response.status}`);
    error.status = response.status;
    throw error;
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

function showLogin() {
  loginView.classList.remove("hidden");
  dashboardView.classList.add("hidden");
}

function showDashboard() {
  loginView.classList.add("hidden");
  dashboardView.classList.remove("hidden");
}

function syncModalScrollLock() {
  const hasOpenModal =
    !userModal.classList.contains("hidden") || !templateModal.classList.contains("hidden");
  document.body.classList.toggle("modal-open", hasOpenModal);
}

function isAdmin() {
  return state.currentUser?.role === "admin";
}

function isStandardUser() {
  return state.currentUser?.role === "manager";
}

function templateVisual(template) {
  const seed = template.id || template.name || "workspace";
  const hue = [...seed].reduce((value, character) => value + character.charCodeAt(0), 0) % 360;

  return template.thumbnail
    ? `linear-gradient(rgba(8,17,31,0.08), rgba(8,17,31,0.42)), url("${template.thumbnail}") center/cover`
    : `radial-gradient(circle at top left, hsla(${hue}, 82%, 70%, 0.3), transparent 34%), linear-gradient(135deg, hsla(${hue}, 72%, 44%, 0.66), rgba(18, 29, 49, 0.92))`;
}

function setTopLevelStatus() {
  templateCount.textContent = String(state.templates.length);
  sessionCount.textContent = String(state.sessions.length);
  currentUserName.textContent = state.currentUser?.name || "-";
  currentUserRole.textContent = state.currentUser
    ? `${state.currentUser.role} | ${state.currentUser.email}`
    : "-";

  if (!state.health) {
    return;
  }

  healthState.textContent = state.health.dockerReady ? "Operational" : "Limited";
  healthCopy.textContent = state.health.dockerReady
    ? "Docker disponible, autenticacion activa y catalogo listo para operar."
    : "El portal carga bien, pero Docker no esta disponible todavia.";
  publicMode.textContent = state.health.publicBaseUrl ? "Public URL" : "Internal";
  standardTemplateCount.textContent = String(state.templates.length);
  standardSessionCount.textContent = String(state.sessions.length);

  openUserModalButton.classList.toggle("hidden", !isAdmin());
  openTemplateModalButton.classList.toggle("hidden", !isAdmin());
  simpleLogoutButton.classList.toggle("hidden", !isStandardUser());
  usersSection.classList.toggle("hidden", !isAdmin());
  adminHero.classList.toggle("hidden", !isAdmin());
  standardHome.classList.toggle("hidden", !isStandardUser());
  document.body.classList.toggle("standard-user-mode", isStandardUser());
}

function createEmptyState(title, copy) {
  const element = document.createElement("article");
  element.className = "empty-state";
  element.innerHTML = `<h3>${title}</h3><p>${copy}</p>`;
  return element;
}

function countSessionsForTemplate(templateId) {
  return state.sessions.filter((session) => session.templateId === templateId).length;
}

function renderStore() {
  if (!storeRoot) {
    return;
  }

  storeRoot.innerHTML = "";
  const normalizedQuery = state.storeQuery.trim().toLowerCase();
  const visibleItems = state.storeItems.filter((item) => {
    if (!normalizedQuery) {
      return true;
    }

    return [item.name, item.description, item.category, item.image]
      .some((value) => value.toLowerCase().includes(normalizedQuery));
  });

  if (!visibleItems.length) {
    storeRoot.appendChild(
      createEmptyState("No hay apps en la busqueda", "Prueba otro termino dentro de la tienda."),
    );
    return;
  }

  for (const item of visibleItems) {
    const node = storeCard.content.firstElementChild.cloneNode(true);
    node.querySelector(".store-card-media").style.background = templateVisual(item);
    node.querySelector(".store-category").textContent = item.category;
    node.querySelector("h3").textContent = item.name;
    node.querySelector(".store-description").textContent = item.description;
    node.querySelector(".store-image").textContent = item.image;

    const button = node.querySelector(".store-install-button");
    if (item.installed) {
      button.textContent = "Installed";
      button.disabled = true;
      button.classList.add("installed");
    } else {
      button.addEventListener("click", () => installStoreItem(item.catalogId));
    }

    storeRoot.appendChild(node);
  }
}

function renderTemplates() {
  templatesRoot.innerHTML = "";

  const normalizedQuery = state.query.trim().toLowerCase();
  const visibleTemplates = state.templates.filter((item) => {
    if (!normalizedQuery) {
      return true;
    }

    return [item.name, item.description, item.category, item.image]
      .some((value) => value.toLowerCase().includes(normalizedQuery));
  });

  if (!visibleTemplates.length) {
    templatesRoot.appendChild(
      createEmptyState("No hay resultados", "Prueba otra busqueda o limpia el filtro actual."),
    );
    return;
  }

  for (const item of visibleTemplates) {
    const node = templateCard.content.firstElementChild.cloneNode(true);
    node.querySelector(".workspace-thumb-media").style.background = templateVisual(item);
    node.querySelector(".workspace-badge").textContent = item.category;
    node.querySelector(".workspace-port").textContent = `:${item.containerPort}`;
    node.querySelector("h3").textContent = item.name;
    node.querySelector(".workspace-desc").textContent = item.description;
    node.querySelector(".workspace-image").textContent = item.image;
    node.querySelector(".workspace-route").textContent =
      `${item.urlPath || "/"} | active: ${countSessionsForTemplate(item.id)}`;
    node.querySelector(".launch-button").addEventListener("click", () => launchSession(item.id));
    templatesRoot.appendChild(node);
  }
}

function renderSessions() {
  sessionsRoot.innerHTML = "";

  if (!state.sessions.length) {
    sessionsRoot.appendChild(
      createEmptyState(
        "No hay sesiones asignadas",
        "Lanza un workspace para que aparezca aqui con ownership por usuario.",
      ),
    );
    return;
  }

  for (const item of state.sessions) {
    const node = sessionCard.content.firstElementChild.cloneNode(true);
    node.querySelector("h3").textContent = item.name;
    node.querySelector(".session-state").textContent = item.state;
    node.querySelector(".session-copy").textContent =
      isAdmin()
        ? `${item.image} | ${item.status} | owner: ${item.ownerName || "n/a"}`
        : `${item.image} | ${item.status}`;

    const openLink = node.querySelector(".open-link");
    openLink.href = item.url || "#";
    openLink.textContent = item.url ? "Open workspace" : "Route unavailable";

    node.querySelector(".direct-link").textContent = item.url || item.localUrl || "Sin URL";
    node.querySelector(".copy-link").addEventListener("click", () => copySessionUrl(item.url || item.localUrl));
    node.querySelector(".stop-session").addEventListener("click", () => stopSession(item.name));
    sessionsRoot.appendChild(node);
  }
}

function renderUsers() {
  usersRoot.innerHTML = "";

  if (!isAdmin()) {
    return;
  }

  if (!state.users.length) {
    usersRoot.appendChild(createEmptyState("No users", "Todavia no hay usuarios cargados."));
    return;
  }

  for (const user of state.users) {
    const node = userCard.content.firstElementChild.cloneNode(true);
    node.querySelector("h3").textContent = user.name;
    node.querySelector(".user-role").textContent = user.role;
    node.querySelector(".user-email").textContent = user.email;
    usersRoot.appendChild(node);
  }
}

async function copySessionUrl(url) {
  if (!url) {
    alert("Esta sesion no tiene una URL copiable.");
    return;
  }

  try {
    await navigator.clipboard.writeText(url);
  } catch (_error) {
    alert(`No pude copiar la URL automaticamente: ${url}`);
  }
}

async function loadHealth() {
  state.health = await request("/api/health");
  setTopLevelStatus();
}

async function loadCurrentUser() {
  try {
    const data = await request("/api/auth/me");
    state.currentUser = data.user;
    showDashboard();
    setTopLevelStatus();
    return true;
  } catch (error) {
    state.currentUser = null;
    showLogin();

    if (error.status !== 401) {
      loginError.textContent = error.message;
    }

    return false;
  }
}

async function loadTemplates() {
  templatesRoot.innerHTML = "";
  templatesRoot.appendChild(createEmptyState("Cargando catalogo", "Preparando el portfolio de workspaces."));
  const data = await request("/api/templates");
  state.templates = data.items;
  setTopLevelStatus();
  renderTemplates();
}

async function loadSessions() {
  sessionsRoot.innerHTML = "";
  sessionsRoot.appendChild(createEmptyState("Consultando sesiones", "Recuperando workspaces asignados."));

  try {
    const data = await request("/api/sessions");
    state.sessions = data.items;
    setTopLevelStatus();
    renderSessions();
  } catch (error) {
    state.sessions = [];
    setTopLevelStatus();
    sessionsRoot.innerHTML = "";
    sessionsRoot.appendChild(createEmptyState("No pude cargar sesiones", error.message));
  }
}

async function loadUsers() {
  if (!isAdmin()) {
    state.users = [];
    renderUsers();
    return;
  }

  const data = await request("/api/users");
  state.users = data.items;
  renderUsers();
}

async function loadStoreItems() {
  if (!isAdmin()) {
    state.storeItems = [];
    renderStore();
    return;
  }

  const data = await request("/api/catalog/linuxserver");
  state.storeItems = data.items;
  renderStore();
}

async function loadDashboardData() {
  await Promise.all([loadHealth(), loadTemplates(), loadSessions(), loadUsers(), loadStoreItems()]);
}

async function login(email, password) {
  loginError.textContent = "";
  await request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  await loadCurrentUser();
  await loadDashboardData();
}

async function logout() {
  await request("/api/auth/logout", { method: "POST" });
  state.currentUser = null;
  state.sessions = [];
  state.templates = [];
  state.users = [];
  userModal.classList.add("hidden");
  templateModal.classList.add("hidden");
  syncModalScrollLock();
  showLogin();
}

async function launchSession(templateId) {
  try {
    await request("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateId }),
    });
    await Promise.all([loadSessions(), loadTemplates()]);
  } catch (error) {
    alert(error.message);
  }
}

async function stopSession(name) {
  try {
    await request(`/api/sessions/${name}`, { method: "DELETE" });
    await Promise.all([loadSessions(), loadTemplates()]);
  } catch (error) {
    alert(error.message);
  }
}

async function createManagedUser() {
  userFormError.textContent = "";

  try {
    await request("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: document.querySelector("#new-user-name").value,
        email: document.querySelector("#new-user-email").value,
        password: document.querySelector("#new-user-password").value,
        role: document.querySelector("#new-user-role").value,
      }),
    });

    userForm.reset();
    userModal.classList.add("hidden");
    await loadUsers();
  } catch (error) {
    userFormError.textContent = error.message;
  }
}

async function createManagedTemplate() {
  templateFormError.textContent = "";
}

async function installStoreItem(catalogId) {
  templateFormError.textContent = "";

  try {
    await request(`/api/catalog/linuxserver/${catalogId}/install`, {
      method: "POST",
    });

    await Promise.all([loadTemplates(), loadStoreItems()]);
  } catch (error) {
    templateFormError.textContent = error.message;
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await login(
    document.querySelector("#login-email").value,
    document.querySelector("#login-password").value,
  );
});

logoutButton.addEventListener("click", logout);
simpleLogoutButton.addEventListener("click", logout);
searchInput.addEventListener("input", (event) => {
  state.query = event.target.value;
  renderTemplates();
});
storeSearchInput?.addEventListener("input", (event) => {
  state.storeQuery = event.target.value;
  renderStore();
});

document.querySelector("#jump-catalog").addEventListener("click", () => {
  document.querySelector(".catalog-panel").scrollIntoView({ behavior: "smooth" });
});

document.querySelector("#refresh-all").addEventListener("click", loadDashboardData);
document.querySelector("#refresh-sessions").addEventListener("click", loadSessions);
document.querySelector("#refresh-sessions-secondary").addEventListener("click", loadSessions);
openUserModalButton.addEventListener("click", () => {
  userModal.classList.remove("hidden");
  syncModalScrollLock();
});
closeUserModalButton.addEventListener("click", () => {
  userModal.classList.add("hidden");
  syncModalScrollLock();
});
openTemplateModalButton.addEventListener("click", () => {
  templateModal.classList.remove("hidden");
  syncModalScrollLock();
});
closeTemplateModalButton.addEventListener("click", () => {
  templateModal.classList.add("hidden");
  syncModalScrollLock();
});
userForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await createManagedUser();
});

const hasSession = await loadCurrentUser();

if (hasSession) {
  try {
    await loadDashboardData();
  } catch (error) {
    loginError.textContent = error.message;
  }
}
