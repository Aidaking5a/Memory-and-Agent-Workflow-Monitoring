(function () {
  const navToggle = document.querySelector("[data-nav-toggle]");
  const navMenu = document.querySelector("[data-nav-menu]");

  if (navToggle && navMenu) {
    navToggle.addEventListener("click", function () {
      const isOpen = navMenu.classList.toggle("open");
      navToggle.setAttribute("aria-expanded", String(isOpen));
    });

    navMenu.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        navMenu.classList.remove("open");
        navToggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  const yearNode = document.querySelector("[data-current-year]");
  if (yearNode) {
    yearNode.textContent = String(new Date().getFullYear());
  }

  const leadForm = document.querySelector("[data-theia-lead-form]");
  if (leadForm instanceof HTMLFormElement) {
    const feedbackNode = leadForm.querySelector("[data-form-feedback]");
    const submitButton = leadForm.querySelector("button[type=\"submit\"]");
    const configuredBase = (leadForm.getAttribute("data-api-base-url") || "").trim();
    const urlParams = new URLSearchParams(window.location.search);
    const queryBase = (urlParams.get("apiBase") || "").trim();
    const localFallback = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" ? "http://localhost:4620" : "";
    const endpointBase = queryBase || configuredBase || localFallback || window.location.origin;

    function setFeedback(message, state) {
      if (!(feedbackNode instanceof HTMLElement)) return;
      feedbackNode.textContent = message;
      feedbackNode.classList.remove("ok", "error");
      if (state === "ok" || state === "error") {
        feedbackNode.classList.add(state);
      }
    }

    leadForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      setFeedback("Sending request...", null);
      if (submitButton instanceof HTMLButtonElement) {
        submitButton.disabled = true;
      }

      try {
        const formData = new FormData(leadForm);
        const payload = Object.fromEntries(formData.entries());
        const response = await fetch(endpointBase.replace(/\/$/, "") + "/api/public/leads", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          const body = await response.json().catch(function () {
            return {};
          });
          if (response.status === 404) {
            throw new Error("Lead API endpoint not configured yet.");
          }
          throw new Error(typeof body.message === "string" ? body.message : "Unable to submit request right now.");
        }

        leadForm.reset();
        setFeedback("Request received. We will follow up shortly.", "ok");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Submission failed.";
        setFeedback(message + " If this continues, email sales@theiaops.ai or set data-api-base-url to your control-plane URL.", "error");
      } finally {
        if (submitButton instanceof HTMLButtonElement) {
          submitButton.disabled = false;
        }
      }
    });
  }
})();
