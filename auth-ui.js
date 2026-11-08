/* Session secrets stay in HttpOnly cookies; only the CSRF token lives in memory. */
export const authState = { user: null, csrfToken: null };
const $ = (id) => document.getElementById(id);
let expiring = false;

export function can(permission) {
  return Boolean(authState.user?.permissions[permission]);
}
export function expireAuthentication() {
  if (expiring) return;
  expiring = true;
  try {
    sessionStorage.setItem(
      "aura.authNotice",
      "Your session expired or access changed. Please sign in again.",
    );
  } catch {
    /* optional storage */
  }
  location.reload();
}
export async function authFetch(url, options = {}) {
  const headers = new Headers(options.headers);
  if (!["GET", "HEAD"].includes((options.method || "GET").toUpperCase()))
    headers.set("X-CSRF-Token", authState.csrfToken || "");
  const response = await fetch(url, {
    ...options,
    headers,
    credentials: "same-origin",
  });
  if (response.status === 401) expireAuthentication();
  return response;
}
async function checkSession() {
  if (!authState.user || expiring) return;
  try {
    const response = await fetch("/api/auth/me", {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (response.status === 401) return expireAuthentication();
    if (response.ok) {
      const current = await response.json();
      // Reload the app on grant/role changes rather than keep stale controls.
      if (JSON.stringify(current.user) !== JSON.stringify(authState.user))
        return location.reload();
    }
  } catch {
    /* Existing request handlers report connection failures. */
  }
}
async function startApplication(session) {
  authState.user = session.user;
  authState.csrfToken = session.csrf_token;
  if (session.user.must_change_password) return showPasswordSetup();
  $("passwordSetupScreen").hidden = true;
  $("loginScreen").hidden = true;
  $("applicationShell").hidden = false;
  $("accountName").textContent = session.user.name;
  $("accountName").title = session.user.name;
  $("accountRole").textContent =
    session.user.role[0].toUpperCase() + session.user.role.slice(1);
  $("logoutButton").onclick = async () => {
    $("logoutButton").disabled = true;
    try {
      const response = await authFetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("Logout failed. Please retry.");
      try {
        sessionStorage.removeItem(
          `aura-maintenance-report-draft:${session.user.user_id}`,
        );
      } catch {
        /* optional storage */
      }
      location.reload();
    } catch (error) {
      $("logoutButton").disabled = false;
      $("accountStatus").textContent = error.message;
    }
  };
  if (location.pathname === "/login")
    history.replaceState(null, "", `/${location.hash}`);
  await import("./app.js");
  setInterval(checkSession, 60000);
  window.addEventListener("focus", checkSession);
}
function showPasswordSetup() {
  $("loginScreen").hidden = true;
  $("applicationShell").hidden = true;
  $("passwordSetupScreen").hidden = false;
  const form = $("passwordSetupForm");
  form.reset();
  $("passwordSetupMessage").textContent =
    "Use your temporary password to choose a private password of at least 15 characters.";
  $("passwordSetupLogout").onclick = async () => {
    try {
      const response = await authFetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("Sign out failed; please retry.");
      location.reload();
    } catch (error) {
      $("passwordSetupMessage").textContent = error.message;
    }
  };
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (form.elements.new_password.value !== form.elements.confirmation.value) {
      $("passwordSetupMessage").textContent = "New passwords do not match.";
      return;
    }
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const response = await authFetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          current_password: form.elements.current_password.value,
          new_password: form.elements.new_password.value,
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Password setup failed");
      form.reset();
      try {
        sessionStorage.setItem(
          "aura.authNotice",
          "Password updated. Sign in with your new password.",
        );
      } catch {
        /* optional storage */
      }
      location.reload();
    } catch (error) {
      $("passwordSetupMessage").textContent = error.message;
    } finally {
      button.disabled = false;
    }
  };
}
async function boot() {
  const form = $("loginForm");
  try {
    const response = await fetch("/api/auth/session", {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok)
      throw new Error(
        "Authentication service is unavailable. Check the server and reload.",
      );
    const session = await response.json();
    if (session.user) return await startApplication(session);
    authState.csrfToken = session.csrf_token;
    $("loginScreen").hidden = false;
    $("loginBootstrap").hidden = !session.bootstrap_required;
    form.querySelector('button[type="submit"]').disabled =
      session.bootstrap_required;
    $("loginMessage").textContent = "Sign in to your AURA workspace.";
    try {
      $("loginMessage").textContent =
        sessionStorage.getItem("aura.authNotice") ||
        $("loginMessage").textContent;
      sessionStorage.removeItem("aura.authNotice");
    } catch {
      /* optional storage */
    }
    form.onsubmit = async (event) => {
      event.preventDefault();
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        const result = await fetch("/api/auth/login", {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": authState.csrfToken,
          },
          body: JSON.stringify({
            username: form.elements.username.value,
            password: form.elements.password.value,
          }),
        });
        const data = await result.json();
        form.elements.password.value = "";
        if (!result.ok) {
          if (result.status === 403) {
            await boot();
            throw new Error("Sign-in form expired. Please try again.");
          }
          throw new Error(data.error || "Sign-in failed");
        }
        await startApplication(data);
      } catch (error) {
        $("loginMessage").textContent = error.message;
      } finally {
        button.disabled = false;
      }
    };
  } catch (error) {
    $("loginScreen").hidden = false;
    $("loginMessage").textContent = error.message;
  }
}
if (typeof document !== "undefined") {
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) location.reload();
  });
  boot();
}
