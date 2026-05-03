(function () {
  const CHART_WINDOW_OPTIONS = [4, 8, 12];
  const DEFAULT_CHART_WINDOW = 8;
  const DEFAULT_CHART_API_PATH = "/api/public/marketing/charts";
  const CHART_FETCH_TIMEOUT_MS = 3600;
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
    const LEAD_AUTH_TOKEN_KEY = "theiaLeadAuthToken";
    const leadAuthForm = document.querySelector("[data-lead-auth-form]");
    const leadAuthFeedbackNode = document.querySelector("[data-lead-auth-feedback]");
    const leadAuthUserNode = document.querySelector("[data-lead-auth-user]");
    const feedbackNode = leadForm.querySelector("[data-form-feedback]");
    const submitButton = leadForm.querySelector("button[type=\"submit\"]");
    const submitLabel = submitButton instanceof HTMLButtonElement ? submitButton.textContent || "Send Request" : "Send Request";
    const configuredBase = (leadForm.getAttribute("data-api-base-url") || "").trim();
    const urlParams = new URLSearchParams(window.location.search);
    const queryBase = (urlParams.get("apiBase") || "").trim();
    const localFallback =
      window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
        ? "http://localhost:4620"
        : "";
    const endpointBase = queryBase || localFallback || configuredBase || window.location.origin;
    const authEndpointBase = endpointBase.replace(/\/$/, "");
    let leadAuthReady = false;

    function getLeadAuthToken() {
      return window.localStorage.getItem(LEAD_AUTH_TOKEN_KEY);
    }

    function setLeadAuthToken(token) {
      if (!token) {
        window.localStorage.removeItem(LEAD_AUTH_TOKEN_KEY);
        return;
      }
      window.localStorage.setItem(LEAD_AUTH_TOKEN_KEY, token);
    }

    function setAuthFeedback(message, state) {
      if (!(leadAuthFeedbackNode instanceof HTMLElement)) return;
      leadAuthFeedbackNode.textContent = message;
      leadAuthFeedbackNode.classList.remove("ok", "error");
      if (state === "ok" || state === "error") {
        leadAuthFeedbackNode.classList.add(state);
      }
    }

    function setAuthUserLabel(email) {
      if (!(leadAuthUserNode instanceof HTMLElement)) return;
      leadAuthUserNode.textContent = email ? "Signed in as " + email : "Not signed in.";
      leadAuthReady = Boolean(email);
      if (submitButton instanceof HTMLButtonElement) {
        submitButton.disabled = !leadAuthReady;
      }
    }

    function setFeedback(message, state) {
      if (!(feedbackNode instanceof HTMLElement)) return;
      feedbackNode.textContent = message;
      feedbackNode.classList.remove("ok", "error");
      if (state === "ok" || state === "error") {
        feedbackNode.classList.add(state);
      }
    }

    function setSubmitBusy(isBusy) {
      if (!(submitButton instanceof HTMLButtonElement)) return;
      submitButton.disabled = isBusy || !leadAuthReady;
      submitButton.textContent = isBusy ? "Sending..." : submitLabel;
    }

    setSubmitBusy(false);

    function findFieldNode(name) {
      return leadForm.querySelector('[name="' + name + '"]');
    }

    function clearFieldErrors() {
      leadForm.querySelectorAll("[data-field-error]").forEach(function (node) {
        node.remove();
      });
      leadForm.querySelectorAll("input, select, textarea").forEach(function (node) {
        node.removeAttribute("aria-invalid");
      });
    }

    function setFieldError(name, message) {
      const field = findFieldNode(name);
      if (!(field instanceof HTMLElement) || !message) return;
      field.setAttribute("aria-invalid", "true");
      const error = document.createElement("p");
      error.className = "field-error";
      error.setAttribute("data-field-error", name);
      error.textContent = message;
      field.insertAdjacentElement("afterend", error);
    }

    function emailValid(value) {
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 200;
    }

    function buildIdempotencyKey() {
      if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return "lead_" + crypto.randomUUID();
      }
      return "lead_" + Date.now() + "_" + Math.random().toString(36).slice(2, 10);
    }

    function validate(formData) {
      const errors = {};
      const name = String(formData.get("name") || "").trim();
      const email = String(formData.get("email") || "").trim().toLowerCase();
      const role = String(formData.get("role") || "").trim();
      const environment = String(formData.get("environment") || "").trim();
      const company = String(formData.get("company") || "").trim();

      if (name.length < 2) errors.name = "Enter at least 2 characters for your name.";
      if (!emailValid(email)) errors.email = "Enter a valid work email address.";
      if (!role) errors.role = "Select your role.";
      if (environment.length < 20) errors.environment = "Provide at least 20 characters so we can scope your setup.";
      if (environment.length > 2000) errors.environment = "Keep this field under 2000 characters.";
      if (company.length > 120) errors.company = "Keep company name under 120 characters.";

      return {
        valid: Object.keys(errors).length === 0,
        errors: errors
      };
    }

    async function refreshLeadAuthStatus() {
      const token = getLeadAuthToken();
      if (!token) {
        setAuthUserLabel("");
        return null;
      }
      try {
        const response = await fetch(authEndpointBase + "/api/public/auth/me", {
          method: "GET",
          headers: {
            Authorization: "Bearer " + token
          }
        });
        if (!response.ok) {
          setLeadAuthToken("");
          setAuthUserLabel("");
          return null;
        }
        const body = await response.json().catch(function () {
          return {};
        });
        const email = body?.user?.email;
        setAuthUserLabel(typeof email === "string" ? email : "");
        return body?.user ?? null;
      } catch {
        setAuthUserLabel("");
        return null;
      }
    }

    async function runLeadAuthAction(action) {
      if (!(leadAuthForm instanceof HTMLFormElement)) return null;
      const formData = new FormData(leadAuthForm);
      const email = String(formData.get("email") || "").trim().toLowerCase();
      const password = String(formData.get("password") || "");
      if (!email || !password) {
        setAuthFeedback("Email and password are required.", "error");
        return null;
      }
      if (!emailValid(email)) {
        setAuthFeedback("Enter a valid email address.", "error");
        return null;
      }
      if (password.length < 10) {
        setAuthFeedback("Password must be at least 10 characters.", "error");
        return null;
      }
      setAuthFeedback(action === "signup" ? "Creating account..." : "Signing in...", null);
      const response = await fetch(authEndpointBase + "/api/public/auth/" + action, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: email,
          password: password
        })
      });
      const body = await response.json().catch(function () {
        return {};
      });
      if (!response.ok) {
        throw new Error(typeof body.message === "string" ? body.message : "Authentication failed.");
      }
      if (typeof body.token !== "string") {
        throw new Error("Authentication token missing from response.");
      }
      setLeadAuthToken(body.token);
      setAuthUserLabel(email);
      setAuthFeedback(action === "signup" ? "Account created and signed in." : "Signed in.", "ok");
      return body.user ?? null;
    }

    if (leadAuthForm instanceof HTMLFormElement) {
      leadAuthForm.querySelectorAll("[data-lead-auth-action]").forEach(function (button) {
        button.addEventListener("click", async function () {
          const action = button.getAttribute("data-lead-auth-action");
          if (action === "logout") {
            const token = getLeadAuthToken();
            if (token) {
              await fetch(authEndpointBase + "/api/public/auth/logout", {
                method: "POST",
                headers: {
                  Authorization: "Bearer " + token
                }
              }).catch(function () {
                return null;
              });
            }
            setLeadAuthToken("");
            setAuthUserLabel("");
            setAuthFeedback("Signed out.", "ok");
            return;
          }
          try {
            await runLeadAuthAction(action === "signup" ? "signup" : "signin");
          } catch (authError) {
            setAuthFeedback(authError instanceof Error ? authError.message : "Authentication failed.", "error");
          }
        });
      });
    }

    void refreshLeadAuthStatus();

    leadForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      clearFieldErrors();
      const formData = new FormData(leadForm);
      const validation = validate(formData);
      if (!validation.valid) {
        Object.entries(validation.errors).forEach(function (entry) {
          setFieldError(entry[0], entry[1]);
        });
        setFeedback("Please fix the highlighted fields and submit again.", "error");
        return;
      }

      if (!formData.get("sourcePage")) {
        formData.set("sourcePage", window.location.pathname || "/contact.html");
      }

      setSubmitBusy(true);
      setFeedback("Sending request...", null);

      try {
        const authUser = await refreshLeadAuthStatus();
        const token = getLeadAuthToken();
        if (!token || !authUser) {
          throw new Error("Sign in is required before submitting an application.");
        }
        const payload = Object.fromEntries(formData.entries());
        const idempotencyKey = buildIdempotencyKey();
        const response = await fetch(endpointBase.replace(/\/$/, "") + "/api/public/leads", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Theia-Idempotency-Key": idempotencyKey,
            Authorization: "Bearer " + token
          },
          body: JSON.stringify(payload)
        });

        const body = await response.json().catch(function () {
          return {};
        });

        if (!response.ok) {
          if (Array.isArray(body.errors)) {
            setFeedback(body.errors.join(" "), "error");
          }
          if (response.status === 404) {
            throw new Error("Lead API endpoint not configured yet.");
          }
          if (response.status === 429) {
            throw new Error("Too many attempts. Please wait a minute and retry.");
          }
          throw new Error(typeof body.message === "string" ? body.message : "Unable to submit request right now.");
        }

        leadForm.reset();
        const ref = typeof body.leadId === "string" ? body.leadId : "pending";
        if (body.deduplicated) {
          setFeedback("Request already received recently (Ref: " + ref + "). We will follow up shortly.", "ok");
        } else {
          setFeedback("Request received (Ref: " + ref + "). We will follow up shortly.", "ok");
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Submission failed.";
        setFeedback(
          message +
            " If this continues, email sales@theiaops.ai or set data-api-base-url to your control-plane URL.",
          "error"
        );
      } finally {
        setSubmitBusy(false);
      }
    });
  }

  initMarketingCharts();

  function initMarketingCharts() {
    const chartRoot = document.querySelector("[data-chart-root]");
    const chartNodes = Array.from(document.querySelectorAll("[data-chart]"));
    if (!(chartRoot instanceof HTMLElement) || chartNodes.length === 0) {
      return;
    }

    const sourceNode = chartRoot.querySelector("[data-chart-source]");
    const tagNodes = Array.from(chartRoot.querySelectorAll("[data-chart-tag]"));
    const filterButtons = Array.from(chartRoot.querySelectorAll("[data-chart-window]"));
    const summaryNodes = Array.from(chartRoot.querySelectorAll("[data-chart-summary]"));

    let selectedWindow = resolveSelectedWindow();
    let bundle = createDefaultMarketingBundle();
    let sourceMeta = {
      label: bundle.sourceLabel,
      quality: bundle.dataQuality,
      generatedAt: bundle.generatedAt
    };

    const chartInstances = chartNodes
      .map(function (node) {
        const chartId = node.getAttribute("data-chart");
        if (!chartId || !bundle.charts[chartId]) {
          return null;
        }

        const card = node.closest(".chart-card");
        const legendNode = card ? card.querySelector('[data-chart-legend="' + chartId + '"]') : null;
        const notesNode = card ? card.querySelector('[data-chart-notes="' + chartId + '"]') : null;
        const state = {
          lockedSeriesId: null,
          previewSeriesId: null,
          hoverIndex: null,
          hoverSeriesId: null
        };

        const render = function () {
          const fullDefinition = bundle.charts[chartId];
          if (!fullDefinition) {
            return;
          }

          const definition = sliceChartDefinition(fullDefinition, selectedWindow);
          if (definition.type === "line") {
            renderLineChart(node, legendNode, definition, state);
          } else {
            renderBarChart(node, legendNode, definition, state);
          }
          renderChartNotes(notesNode, definition);
        };

        render();

        if (typeof ResizeObserver === "function") {
          const observer = new ResizeObserver(function () {
            render();
          });
          observer.observe(node);
        } else {
          window.addEventListener("resize", render);
        }

        return {
          render: render
        };
      })
      .filter(Boolean);

    syncWindowButtons(filterButtons, selectedWindow);
    applySourceMeta(sourceNode, tagNodes, sourceMeta);
    renderChartSummaries(summaryNodes, bundle, selectedWindow, sourceMeta);

    filterButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        const nextWindow = Number(button.getAttribute("data-chart-window") || DEFAULT_CHART_WINDOW);
        if (!CHART_WINDOW_OPTIONS.includes(nextWindow) || nextWindow === selectedWindow) {
          return;
        }

        selectedWindow = nextWindow;
        syncWindowButtons(filterButtons, selectedWindow);
        persistSelectedWindow(selectedWindow);
        chartInstances.forEach(function (instance) {
          instance.render();
        });
        renderChartSummaries(summaryNodes, bundle, selectedWindow, sourceMeta);
      });
    });

    const candidates = resolveChartApiCandidates(chartRoot);
    if (candidates.length > 0) {
      loadRemoteMarketingBundle(candidates)
        .then(function (remote) {
          if (!remote) {
            return;
          }
          bundle = remote.bundle;
          sourceMeta = remote.source;
          applySourceMeta(sourceNode, tagNodes, sourceMeta);
          chartInstances.forEach(function (instance) {
            instance.render();
          });
          renderChartSummaries(summaryNodes, bundle, selectedWindow, sourceMeta);
        })
        .catch(function () {
          applySourceMeta(sourceNode, tagNodes, sourceMeta);
        });
    }
  }

  function createDefaultMarketingBundle() {
    const labels = [
      "Week 1",
      "Week 2",
      "Week 3",
      "Week 4",
      "Week 5",
      "Week 6",
      "Week 7",
      "Week 8",
      "Week 9",
      "Week 10",
      "Week 11",
      "Week 12"
    ];

    return {
      sourceLabel: "Sample Data",
      dataQuality: "sample",
      generatedAt: null,
      charts: {
        coverage: {
          type: "line",
          yLabel: "Percent",
          labels: labels,
          series: [
            {
              id: "evidence",
              name: "Evidence-linked conclusions",
              color: "#ff6868",
              values: [70, 72, 74, 77, 79, 81, 84, 86, 88, 89, 90, 91],
              suffix: "%"
            },
            {
              id: "policy",
              name: "Policy-passing workflows",
              color: "#ffb84d",
              values: [58, 60, 63, 65, 68, 70, 73, 76, 79, 82, 84, 86],
              suffix: "%"
            }
          ],
          annotations: [
            {
              index: 4,
              title: "Policy gate v2",
              detail: "Gate rules tightened for unsupported automation paths."
            },
            {
              index: 8,
              title: "Memory freshness review",
              detail: "Memory drift checks introduced before workflow promotion."
            }
          ]
        },
        alerts: {
          type: "bar",
          yLabel: "Weekly alerts",
          labels: labels,
          series: [
            {
              id: "high",
              name: "High/Critical",
              color: "#ff5f5f",
              values: [46, 44, 42, 39, 36, 34, 31, 28, 25, 22, 20, 18],
              suffix: " alerts"
            },
            {
              id: "medium",
              name: "Medium",
              color: "#ffb84d",
              values: [60, 58, 56, 54, 51, 49, 46, 44, 42, 39, 36, 33],
              suffix: " alerts"
            },
            {
              id: "low",
              name: "Low/Info",
              color: "#3ecf8e",
              values: [20, 22, 24, 25, 27, 29, 31, 33, 35, 37, 39, 40],
              suffix: " alerts"
            }
          ],
          annotations: [
            {
              index: 5,
              title: "Tool grounding checks",
              detail: "Tool-output verification reduced high-severity escalation risk."
            }
          ]
        }
      }
    };
  }

  function resolveSelectedWindow() {
    const params = new URLSearchParams(window.location.search);
    const candidate = Number(params.get("chartWindow") || DEFAULT_CHART_WINDOW);
    return CHART_WINDOW_OPTIONS.includes(candidate) ? candidate : DEFAULT_CHART_WINDOW;
  }

  function persistSelectedWindow(windowSize) {
    const url = new URL(window.location.href);
    if (windowSize === DEFAULT_CHART_WINDOW) {
      url.searchParams.delete("chartWindow");
    } else {
      url.searchParams.set("chartWindow", String(windowSize));
    }
    window.history.replaceState({}, "", url.toString());
  }

  function syncWindowButtons(buttons, selectedWindow) {
    buttons.forEach(function (button) {
      const buttonWindow = Number(button.getAttribute("data-chart-window") || DEFAULT_CHART_WINDOW);
      const isActive = buttonWindow === selectedWindow;
      button.setAttribute("data-active", isActive ? "true" : "false");
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
  }

  function resolveChartApiCandidates(chartRoot) {
    const params = new URLSearchParams(window.location.search);
    const directUrl = (params.get("chartDataUrl") || "").trim();
    const queryBase = (params.get("chartApiBase") || params.get("apiBase") || "").trim();
    const configuredBase = (chartRoot.getAttribute("data-chart-api-base-url") || "").trim();
    const localFallback =
      window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
        ? "http://localhost:4620"
        : "";

    const candidates = [];
    if (directUrl) {
      candidates.push(directUrl);
    }

    [queryBase, configuredBase, localFallback]
      .filter(Boolean)
      .forEach(function (base) {
        candidates.push(base.replace(/\/$/, "") + DEFAULT_CHART_API_PATH);
      });

    if (window.location.origin && !window.location.origin.includes("github.io")) {
      candidates.push(window.location.origin.replace(/\/$/, "") + DEFAULT_CHART_API_PATH);
    }

    const deduped = [];
    const seen = new Set();
    candidates.forEach(function (candidate) {
      if (!seen.has(candidate)) {
        seen.add(candidate);
        deduped.push(candidate);
      }
    });
    return deduped;
  }

  async function loadRemoteMarketingBundle(candidates) {
    for (const endpoint of candidates) {
      try {
        const payload = await fetchJsonWithTimeout(endpoint, CHART_FETCH_TIMEOUT_MS);
        const normalized = normalizeMarketingBundle(payload);
        if (!normalized) {
          continue;
        }

        return {
          bundle: normalized,
          source: {
            label: normalized.sourceLabel || (normalized.dataQuality === "live" ? "Live Data" : "Sample Data"),
            quality: normalized.dataQuality,
            generatedAt: normalized.generatedAt
          }
        };
      } catch (_error) {
        continue;
      }
    }

    return null;
  }

  async function fetchJsonWithTimeout(url, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(function () {
      controller.abort();
    }, timeoutMs);

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json"
        },
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error("Chart endpoint unavailable: " + response.status);
      }

      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  function normalizeMarketingBundle(payload) {
    if (!payload || typeof payload !== "object") {
      return null;
    }

    const candidateCharts = payload.charts;
    if (!candidateCharts || typeof candidateCharts !== "object") {
      return null;
    }

    const defaults = createDefaultMarketingBundle();
    const normalizedCharts = {};

    for (const [chartId, fallbackDefinition] of Object.entries(defaults.charts)) {
      const normalized = normalizeChartDefinition(candidateCharts[chartId], fallbackDefinition);
      normalizedCharts[chartId] = normalized;
    }

    return {
      sourceLabel:
        typeof payload.sourceLabel === "string" && payload.sourceLabel.trim().length > 0
          ? payload.sourceLabel.trim()
          : defaults.sourceLabel,
      dataQuality: payload.dataQuality === "live" ? "live" : "sample",
      generatedAt: normalizeDate(payload.generatedAt),
      charts: normalizedCharts
    };
  }

  function normalizeDate(value) {
    if (typeof value !== "string" || value.trim().length === 0) {
      return null;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  function normalizeChartDefinition(candidate, fallbackDefinition) {
    if (!candidate || typeof candidate !== "object") {
      return cloneChartDefinition(fallbackDefinition);
    }

    const labels = Array.isArray(candidate.labels)
      ? candidate.labels
          .map(function (entry) {
            return String(entry || "").trim();
          })
          .filter(Boolean)
      : fallbackDefinition.labels.slice();

    const seriesInput = Array.isArray(candidate.series) ? candidate.series : [];
    const normalizedSeries = seriesInput
      .map(function (series, index) {
        if (!series || typeof series !== "object") {
          return null;
        }

        const values = Array.isArray(series.values)
          ? series.values
              .map(function (value) {
                const number = Number(value);
                return Number.isFinite(number) ? number : NaN;
              })
              .filter(function (value) {
                return Number.isFinite(value);
              })
          : [];

        if (values.length !== labels.length || labels.length < 2) {
          return null;
        }

        const fallbackSeries = fallbackDefinition.series[index] || fallbackDefinition.series[0];

        return {
          id:
            typeof series.id === "string" && series.id.trim().length > 0
              ? series.id.trim()
              : fallbackSeries.id + "-" + index,
          name:
            typeof series.name === "string" && series.name.trim().length > 0
              ? series.name.trim()
              : fallbackSeries.name,
          color:
            typeof series.color === "string" && series.color.trim().length > 0
              ? series.color.trim()
              : fallbackSeries.color,
          values: values,
          suffix:
            typeof series.suffix === "string"
              ? series.suffix
              : typeof fallbackSeries.suffix === "string"
                ? fallbackSeries.suffix
                : ""
        };
      })
      .filter(Boolean);

    if (normalizedSeries.length === 0 || labels.length < 2) {
      return cloneChartDefinition(fallbackDefinition);
    }

    const annotationsInput = Array.isArray(candidate.annotations) ? candidate.annotations : [];
    const normalizedAnnotations = annotationsInput
      .map(function (annotation) {
        if (!annotation || typeof annotation !== "object") {
          return null;
        }
        const index = Number(annotation.index);
        if (!Number.isInteger(index) || index < 0 || index >= labels.length) {
          return null;
        }

        const title = typeof annotation.title === "string" ? annotation.title.trim() : "";
        if (!title) {
          return null;
        }

        return {
          index: index,
          title: title,
          detail: typeof annotation.detail === "string" ? annotation.detail.trim() : ""
        };
      })
      .filter(Boolean);

    return {
      type: candidate.type === "bar" ? "bar" : fallbackDefinition.type,
      yLabel:
        typeof candidate.yLabel === "string" && candidate.yLabel.trim().length > 0
          ? candidate.yLabel.trim()
          : fallbackDefinition.yLabel,
      labels: labels,
      series: normalizedSeries,
      annotations: normalizedAnnotations
    };
  }

  function cloneChartDefinition(definition) {
    return {
      type: definition.type,
      yLabel: definition.yLabel,
      labels: definition.labels.slice(),
      series: definition.series.map(function (series) {
        return {
          id: series.id,
          name: series.name,
          color: series.color,
          values: series.values.slice(),
          suffix: series.suffix
        };
      }),
      annotations: (definition.annotations || []).map(function (annotation) {
        return {
          index: annotation.index,
          title: annotation.title,
          detail: annotation.detail || ""
        };
      })
    };
  }

  function sliceChartDefinition(definition, selectedWindow) {
    const labels = definition.labels;
    const effectiveWindow = Math.min(Math.max(2, selectedWindow), labels.length);
    const startIndex = Math.max(0, labels.length - effectiveWindow);

    return {
      type: definition.type,
      yLabel: definition.yLabel,
      labels: labels.slice(startIndex),
      series: definition.series.map(function (series) {
        return {
          id: series.id,
          name: series.name,
          color: series.color,
          values: series.values.slice(startIndex),
          suffix: series.suffix
        };
      }),
      annotations: (definition.annotations || [])
        .filter(function (annotation) {
          return annotation.index >= startIndex;
        })
        .map(function (annotation) {
          return {
            index: annotation.index - startIndex,
            title: annotation.title,
            detail: annotation.detail || ""
          };
        })
    };
  }

  function applySourceMeta(sourceNode, tagNodes, sourceMeta) {
    const sourceLabel = sourceMeta.quality === "live" ? "Live Data" : "Sample Data";

    tagNodes.forEach(function (tagNode) {
      tagNode.textContent = sourceLabel;
    });

    if (!(sourceNode instanceof HTMLElement)) {
      return;
    }

    const sourceParts = ["Source: " + (sourceMeta.label || sourceLabel)];
    if (sourceMeta.generatedAt) {
      const renderedDate = new Date(sourceMeta.generatedAt).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric"
      });
      sourceParts.push("Updated " + renderedDate);
    }

    sourceNode.textContent = sourceParts.join(" | ");
  }

  function renderChartSummaries(summaryNodes, bundle, selectedWindow, sourceMeta) {
    summaryNodes.forEach(function (summaryNode) {
      const chartId = summaryNode.getAttribute("data-chart-summary");
      if (!chartId || !bundle.charts[chartId]) {
        return;
      }

      const listNode = summaryNode.querySelector("[data-chart-summary-list]");
      if (!(listNode instanceof HTMLElement)) {
        return;
      }

      const metaNode = summaryNode.querySelector(".chart-summary-meta");
      if (metaNode instanceof HTMLElement) {
        metaNode.textContent =
          "Window: last " + selectedWindow + " weeks | Source: " + (sourceMeta.label || sourceMeta.quality);
      }

      const filteredDefinition = sliceChartDefinition(bundle.charts[chartId], selectedWindow);
      const lines = buildSummaryLines(filteredDefinition);
      listNode.innerHTML = lines
        .map(function (line) {
          return "<li>" + escapeHtml(line) + "</li>";
        })
        .join("");
    });
  }

  function buildSummaryLines(definition) {
    const lines = [];

    definition.series.forEach(function (series) {
      if (series.values.length < 2) {
        return;
      }

      const startValue = series.values[0];
      const endValue = series.values[series.values.length - 1];
      const delta = roundOne(endValue - startValue);
      const deltaPrefix = delta > 0 ? "+" : "";
      const trimmedSuffix = String(series.suffix || "").trim();
      const deltaUnits = trimmedSuffix === "%" ? " pts" : trimmedSuffix ? trimmedSuffix : "";

      lines.push(
        series.name +
          " moved from " +
          formatMetricValue(startValue, series.suffix) +
          " to " +
          formatMetricValue(endValue, series.suffix) +
          " (" +
          deltaPrefix +
          delta +
          deltaUnits +
          ")."
      );
    });

    const firstAnnotation = (definition.annotations || [])[0];
    if (firstAnnotation) {
      lines.push(definition.labels[firstAnnotation.index] + " inflection point: " + firstAnnotation.title + ".");
    }

    return lines.slice(0, 3);
  }

  function renderChartNotes(noteNode, definition) {
    if (!(noteNode instanceof HTMLElement)) {
      return;
    }

    const annotations = (definition.annotations || []).slice(0, 3);
    if (annotations.length === 0) {
      noteNode.innerHTML = "<li>No major inflection notes in this selected window.</li>";
      return;
    }

    noteNode.innerHTML = annotations
      .map(function (annotation) {
        const label = definition.labels[annotation.index] || "Selected period";
        const detail = annotation.detail ? " " + annotation.detail : "";
        return (
          "<li><strong>" +
          escapeHtml(label + ":") +
          "</strong> " +
          escapeHtml(annotation.title + detail) +
          "</li>"
        );
      })
      .join("");
  }

  function renderLineChart(container, legendNode, definition, state) {
    const width = Math.max(340, container.clientWidth || 340);
    const height = width > 980 ? 392 : width > 760 ? 346 : 304;
    const margin = { top: 30, right: 28, bottom: 44, left: 56 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const labels = definition.labels;
    const series = definition.series;

    const allValues = series.flatMap(function (item) {
      return item.values;
    });

    const valueBounds = resolveValueBounds(allValues, series[0]?.suffix);
    const yTicks = createTicks(valueBounds.min, valueBounds.max, 5);

    const xFor = function (index) {
      if (labels.length <= 1) return margin.left;
      return margin.left + (plotWidth / (labels.length - 1)) * index;
    };

    const yFor = function (value) {
      return margin.top + ((valueBounds.max - value) / Math.max(1, valueBounds.max - valueBounds.min)) * plotHeight;
    };

    const activeSeriesId = state.lockedSeriesId || state.previewSeriesId;

    container.innerHTML = "";
    const tooltip = createTooltip();

    const svg = createSvg("svg", {
      viewBox: "0 0 " + width + " " + height,
      "aria-hidden": "true"
    });

    yTicks.forEach(function (tick) {
      const y = yFor(tick);
      svg.appendChild(
        createSvg("line", {
          x1: String(margin.left),
          y1: String(y),
          x2: String(width - margin.right),
          y2: String(y),
          class: "chart-grid-line"
        })
      );
      svg.appendChild(
        createSvg(
          "text",
          {
            x: String(margin.left - 12),
            y: String(y + 4),
            "text-anchor": "end",
            class: "chart-axis"
          },
          formatMetricValue(tick, series[0]?.suffix)
        )
      );
    });

    svg.appendChild(
      createSvg("line", {
        x1: String(margin.left),
        y1: String(height - margin.bottom),
        x2: String(width - margin.right),
        y2: String(height - margin.bottom),
        class: "chart-axis-line"
      })
    );

    labels.forEach(function (label, index) {
      if (!shouldRenderXAxisLabel(index, labels.length, width)) {
        return;
      }
      const x = xFor(index);
      svg.appendChild(
        createSvg(
          "text",
          {
            x: String(x),
            y: String(height - margin.bottom + 20),
            "text-anchor": "middle",
            class: "chart-axis"
          },
          shortLabel(label)
        )
      );
    });

    series.forEach(function (item) {
      const dimmed = Boolean(activeSeriesId) && activeSeriesId !== item.id;
      const points = item.values
        .map(function (value, index) {
          return (index === 0 ? "M" : "L") + xFor(index) + " " + yFor(value);
        })
        .join(" ");

      svg.appendChild(
        createSvg("path", {
          d: points,
          class: "chart-series-path",
          stroke: item.color,
          "data-dimmed": dimmed ? "true" : "false",
          "data-highlight": activeSeriesId === item.id ? "true" : "false"
        })
      );

      item.values.forEach(function (value, index) {
        svg.appendChild(
          createSvg("circle", {
            cx: String(xFor(index)),
            cy: String(yFor(value)),
            r: state.hoverIndex === index ? "6" : "4",
            class: "chart-marker",
            fill: item.color,
            "data-dimmed": dimmed ? "true" : "false",
            "data-active": state.hoverIndex === index ? "true" : "false"
          })
        );
      });
    });

    renderAnnotations(svg, definition.annotations || [], labels, xFor, {
      top: margin.top,
      bottom: height - margin.bottom,
      width: width,
      right: margin.right
    });

    if (typeof state.hoverIndex === "number") {
      const hoverX = xFor(state.hoverIndex);
      svg.appendChild(
        createSvg("line", {
          x1: String(hoverX),
          y1: String(margin.top),
          x2: String(hoverX),
          y2: String(height - margin.bottom),
          class: "chart-grid-line"
        })
      );

      const tooltipRows = series
        .filter(function (item) {
          return !activeSeriesId || item.id === activeSeriesId;
        })
        .map(function (item) {
          return {
            key: item.name,
            value: formatMetricValue(item.values[state.hoverIndex], item.suffix),
            color: item.color
          };
        });

      const annotation = (definition.annotations || []).find(function (entry) {
        return entry.index === state.hoverIndex;
      });
      if (annotation) {
        tooltipRows.push({
          key: "Inflection",
          value: annotation.title,
          color: "#ffd1d1"
        });
      }

      updateTooltip(
        tooltip,
        {
          title: labels[state.hoverIndex],
          rows: tooltipRows
        },
        {
          x: hoverX,
          y: margin.top + 8,
          width: width,
          height: height
        }
      );
    }

    labels.forEach(function (_label, index) {
      const startX = index === 0 ? margin.left : xFor(index - 1) + (xFor(index) - xFor(index - 1)) / 2;
      const endX =
        index === labels.length - 1
          ? width - margin.right
          : xFor(index) + (xFor(index + 1) - xFor(index)) / 2;

      const hitArea = createSvg("rect", {
        x: String(startX),
        y: String(margin.top),
        width: String(Math.max(16, endX - startX)),
        height: String(plotHeight),
        tabindex: "0",
        class: "chart-hit",
        "aria-label": labels[index] + " values"
      });

      hitArea.addEventListener("pointerenter", function () {
        state.hoverIndex = index;
        renderLineChart(container, legendNode, definition, state);
      });
      hitArea.addEventListener("pointerdown", function (event) {
        event.preventDefault();
        state.hoverIndex = state.hoverIndex === index ? null : index;
        renderLineChart(container, legendNode, definition, state);
      });
      hitArea.addEventListener("focus", function () {
        state.hoverIndex = index;
        renderLineChart(container, legendNode, definition, state);
      });
      hitArea.addEventListener("pointerleave", function (event) {
        if (event.pointerType === "touch") {
          return;
        }
        state.hoverIndex = null;
        renderLineChart(container, legendNode, definition, state);
      });
      hitArea.addEventListener("blur", function () {
        state.hoverIndex = null;
        renderLineChart(container, legendNode, definition, state);
      });

      svg.appendChild(hitArea);
    });

    container.appendChild(svg);
    container.appendChild(tooltip);
    renderLegend(legendNode, definition.series, state, function () {
      renderLineChart(container, legendNode, definition, state);
    });
  }

  function renderBarChart(container, legendNode, definition, state) {
    const width = Math.max(340, container.clientWidth || 340);
    const height = width > 980 ? 392 : width > 760 ? 346 : 304;
    const margin = { top: 30, right: 28, bottom: 44, left: 56 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const labels = definition.labels;
    const series = definition.series;

    const maxValue =
      Math.ceil(
        Math.max.apply(
          null,
          series.flatMap(function (item) {
            return item.values;
          })
        ) / 10
      ) * 10;

    const yTicks = [];
    for (let value = 0; value <= maxValue; value += 10) {
      yTicks.push(value);
    }

    const groupWidth = plotWidth / labels.length;
    const barWidth = Math.max(9, Math.min(22, groupWidth / (series.length + 1.2)));
    const activeSeriesId = state.lockedSeriesId || state.previewSeriesId;

    const yFor = function (value) {
      return margin.top + ((maxValue - value) / Math.max(1, maxValue)) * plotHeight;
    };

    container.innerHTML = "";
    const tooltip = createTooltip();

    const svg = createSvg("svg", {
      viewBox: "0 0 " + width + " " + height,
      "aria-hidden": "true"
    });

    yTicks.forEach(function (tick) {
      const y = yFor(tick);
      svg.appendChild(
        createSvg("line", {
          x1: String(margin.left),
          y1: String(y),
          x2: String(width - margin.right),
          y2: String(y),
          class: "chart-grid-line"
        })
      );
      svg.appendChild(
        createSvg(
          "text",
          {
            x: String(margin.left - 12),
            y: String(y + 4),
            "text-anchor": "end",
            class: "chart-axis"
          },
          String(tick)
        )
      );
    });

    svg.appendChild(
      createSvg("line", {
        x1: String(margin.left),
        y1: String(height - margin.bottom),
        x2: String(width - margin.right),
        y2: String(height - margin.bottom),
        class: "chart-axis-line"
      })
    );

    labels.forEach(function (label, index) {
      const groupLeft = margin.left + groupWidth * index;
      const totalBarWidth = barWidth * series.length + 4 * (series.length - 1);
      const offset = (groupWidth - totalBarWidth) / 2;

      if (shouldRenderXAxisLabel(index, labels.length, width)) {
        svg.appendChild(
          createSvg(
            "text",
            {
              x: String(groupLeft + groupWidth / 2),
              y: String(height - margin.bottom + 20),
              "text-anchor": "middle",
              class: "chart-axis"
            },
            shortLabel(label)
          )
        );
      }

      series.forEach(function (item, seriesIndex) {
        const value = item.values[index];
        const barHeight = Math.max(1, height - margin.bottom - yFor(value));
        const x = groupLeft + offset + seriesIndex * (barWidth + 4);
        const y = yFor(value);
        const dimmed = Boolean(activeSeriesId) && activeSeriesId !== item.id;
        const isActive = state.hoverIndex === index && state.hoverSeriesId === item.id;

        const bar = createSvg("rect", {
          x: String(x),
          y: String(y),
          width: String(barWidth),
          height: String(barHeight),
          rx: "3",
          ry: "3",
          fill: item.color,
          class: "chart-bar",
          tabindex: "0",
          "aria-label": item.name + " " + label + " " + formatMetricValue(value, item.suffix),
          "data-dimmed": dimmed ? "true" : "false",
          "data-active": isActive ? "true" : "false"
        });

        const showBarTooltip = function () {
          state.hoverIndex = index;
          state.hoverSeriesId = item.id;
          renderBarChart(container, legendNode, definition, state);
        };

        const hideBarTooltip = function () {
          state.hoverIndex = null;
          state.hoverSeriesId = null;
          renderBarChart(container, legendNode, definition, state);
        };

        bar.addEventListener("pointerenter", showBarTooltip);
        bar.addEventListener("pointerdown", function (event) {
          event.preventDefault();
          if (state.hoverIndex === index && state.hoverSeriesId === item.id) {
            hideBarTooltip();
            return;
          }
          showBarTooltip();
        });
        bar.addEventListener("focus", showBarTooltip);
        bar.addEventListener("pointerleave", function (event) {
          if (event.pointerType === "touch") {
            return;
          }
          hideBarTooltip();
        });
        bar.addEventListener("blur", hideBarTooltip);

        svg.appendChild(bar);
      });
    });

    renderAnnotations(
      svg,
      definition.annotations || [],
      labels,
      function (index) {
        const groupLeft = margin.left + groupWidth * index;
        return groupLeft + groupWidth / 2;
      },
      {
        top: margin.top,
        bottom: height - margin.bottom,
        width: width,
        right: margin.right
      }
    );

    if (typeof state.hoverIndex === "number" && state.hoverSeriesId) {
      const hoveredSeries = series.find(function (item) {
        return item.id === state.hoverSeriesId;
      });
      if (hoveredSeries) {
        const groupLeft = margin.left + groupWidth * state.hoverIndex;
        const seriesIndex = series.findIndex(function (item) {
          return item.id === hoveredSeries.id;
        });
        const totalBarWidth = barWidth * series.length + 4 * (series.length - 1);
        const offset = (groupWidth - totalBarWidth) / 2;
        const value = hoveredSeries.values[state.hoverIndex];
        const x = groupLeft + offset + seriesIndex * (barWidth + 4) + barWidth / 2;

        const tooltipRows = [
          {
            key: hoveredSeries.name,
            value: formatMetricValue(value, hoveredSeries.suffix),
            color: hoveredSeries.color
          }
        ];

        const annotation = (definition.annotations || []).find(function (entry) {
          return entry.index === state.hoverIndex;
        });
        if (annotation) {
          tooltipRows.push({
            key: "Inflection",
            value: annotation.title,
            color: "#ffd1d1"
          });
        }

        updateTooltip(
          tooltip,
          {
            title: labels[state.hoverIndex],
            rows: tooltipRows
          },
          {
            x: x,
            y: yFor(value) - 8,
            width: width,
            height: height
          }
        );
      }
    }

    container.appendChild(svg);
    container.appendChild(tooltip);
    renderLegend(legendNode, definition.series, state, function () {
      renderBarChart(container, legendNode, definition, state);
    });
  }

  function renderAnnotations(svg, annotations, labels, xFor, bounds) {
    annotations.slice(0, 3).forEach(function (annotation, noteIndex) {
      const x = xFor(annotation.index);
      if (!Number.isFinite(x)) {
        return;
      }

      const line = createSvg("line", {
        x1: String(x),
        y1: String(bounds.top + 4),
        x2: String(x),
        y2: String(bounds.bottom),
        class: "chart-annotation-line"
      });

      const dot = createSvg("circle", {
        cx: String(x),
        cy: String(bounds.top + 8),
        r: "3.2",
        class: "chart-annotation-dot"
      });

      const labelText = shortAnnotationLabel(annotation.title, labels[annotation.index]);
      const useRightAnchor = x > bounds.width - bounds.right - 125;
      const text = createSvg(
        "text",
        {
          x: String(useRightAnchor ? x - 8 : x + 8),
          y: String(bounds.top + 12 + noteIndex * 13),
          "text-anchor": useRightAnchor ? "end" : "start",
          class: "chart-annotation-label"
        },
        labelText
      );

      if (annotation.detail) {
        text.appendChild(createSvg("title", {}, annotation.detail));
      }

      svg.appendChild(line);
      svg.appendChild(dot);
      svg.appendChild(text);
    });
  }

  function renderLegend(legendNode, series, state, rerender) {
    if (!(legendNode instanceof HTMLElement)) {
      return;
    }

    legendNode.innerHTML = "";
    const activeSeriesId = state.lockedSeriesId || state.previewSeriesId;

    series.forEach(function (item) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = item.name;
      button.style.borderColor = item.color;
      const isActive = activeSeriesId === item.id;
      const isDimmed = Boolean(activeSeriesId) && activeSeriesId !== item.id;
      button.setAttribute("data-active", isActive ? "true" : "false");
      button.setAttribute("data-dimmed", isDimmed ? "true" : "false");

      button.addEventListener("mouseenter", function () {
        if (!state.lockedSeriesId) {
          state.previewSeriesId = item.id;
          rerender();
        }
      });
      button.addEventListener("focus", function () {
        if (!state.lockedSeriesId) {
          state.previewSeriesId = item.id;
          rerender();
        }
      });
      button.addEventListener("mouseleave", function () {
        if (!state.lockedSeriesId) {
          state.previewSeriesId = null;
          rerender();
        }
      });
      button.addEventListener("blur", function () {
        if (!state.lockedSeriesId) {
          state.previewSeriesId = null;
          rerender();
        }
      });
      button.addEventListener("click", function () {
        state.lockedSeriesId = state.lockedSeriesId === item.id ? null : item.id;
        if (!state.lockedSeriesId) {
          state.previewSeriesId = null;
        }
        rerender();
      });

      legendNode.appendChild(button);
    });
  }

  function createTooltip() {
    const tooltip = document.createElement("div");
    tooltip.className = "chart-tooltip";
    tooltip.setAttribute("role", "status");
    tooltip.setAttribute("aria-live", "polite");
    return tooltip;
  }

  function updateTooltip(tooltip, content, bounds) {
    if (!(tooltip instanceof HTMLElement)) {
      return;
    }

    const rowsMarkup = content.rows
      .map(function (row) {
        return (
          '<p class="tooltip-row"><span class="tooltip-key"><span class="tooltip-dot" style="background:' +
          row.color +
          '"></span>' +
          escapeHtml(row.key) +
          "</span><strong>" +
          escapeHtml(row.value) +
          "</strong></p>"
        );
      })
      .join("");

    tooltip.innerHTML = '<p class="tooltip-title">' + escapeHtml(content.title) + "</p>" + rowsMarkup;
    tooltip.classList.add("visible");
    tooltip.style.left = String(Math.max(74, Math.min(bounds.width - 74, bounds.x))) + "px";
    tooltip.style.top = String(Math.max(16, Math.min(bounds.height - 64, bounds.y))) + "px";
  }

  function resolveValueBounds(values, suffix) {
    const maxValue = Math.max.apply(null, values);
    const minValue = Math.min.apply(null, values);
    const span = Math.max(1, maxValue - minValue);

    let min = minValue - span * 0.2;
    let max = maxValue + span * 0.14;

    if (String(suffix || "").trim() === "%") {
      min = Math.max(0, min);
      max = Math.min(100, max);
    }

    if (max - min < 6) {
      max += 3;
      min = Math.max(0, min - 3);
    }

    return {
      min: roundOne(min),
      max: roundOne(max)
    };
  }

  function createTicks(min, max, segments) {
    const ticks = [];
    for (let index = 0; index <= segments; index += 1) {
      const ratio = index / segments;
      ticks.push(roundOne(min + (max - min) * (1 - ratio)));
    }
    return ticks;
  }

  function shouldRenderXAxisLabel(index, total, width) {
    if (total <= 6) return true;
    if (index === 0 || index === total - 1) return true;
    if (width <= 430) return index % 3 === 0;
    if (width <= 620) return index % 2 === 0;
    return true;
  }

  function shortLabel(label) {
    return String(label).replace(/^Week\s+/i, "W");
  }

  function shortAnnotationLabel(title, fallbackLabel) {
    const content = String(title || fallbackLabel || "Note").trim();
    return content.length > 23 ? content.slice(0, 22) + "..." : content;
  }

  function formatMetricValue(value, suffix) {
    const rounded = roundOne(value);
    const suffixText = String(suffix || "");
    if (suffixText.trim() === "%") {
      return String(Math.round(rounded)) + "%";
    }
    if (Math.abs(rounded) >= 1000) {
      return Math.round(rounded).toLocaleString() + suffixText;
    }
    if (Number.isInteger(rounded)) {
      return String(rounded) + suffixText;
    }
    return rounded.toFixed(1) + suffixText;
  }

  function roundOne(value) {
    return Math.round(value * 10) / 10;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function createSvg(name, attributes, text) {
    const element = document.createElementNS("http://www.w3.org/2000/svg", name);
    Object.keys(attributes || {}).forEach(function (key) {
      if (attributes[key] !== undefined && attributes[key] !== null) {
        element.setAttribute(key, attributes[key]);
      }
    });
    if (typeof text === "string") {
      element.textContent = text;
    }
    return element;
  }
})();
