const $ = (id) => document.getElementById(id);
const form = $("prompt-form");
const prompt = $("prompt");
const runButton = $("run-button");
const errorMessage = $("form-error");
const evidence = $("evidence");
const replayNote = $("replay-note");
const proofStatus = $("proof-status");
const proofExplanation = $("proof-explanation");
const observedPath = $("observed-path");
const examples = [...document.querySelectorAll("[data-question]")];
const cards = {
  before: { card: $("before-card"), status: $("before-status"), answer: $("before-answer"), steps: $("before-steps"), time: $("before-time"), source: $("before-source"), sourceText: $("before-source-text"), sourceId: $("before-source-id"), outcome: $("before-outcome"), detail: $("before-detail"), result: null },
  after: { card: $("after-card"), status: $("after-status"), answer: $("after-answer"), steps: $("after-steps"), time: $("after-time"), source: $("after-source"), sourceText: $("after-source-text"), sourceId: $("after-source-id"), outcome: $("after-outcome"), detail: $("after-detail"), result: null }
};

let running = false;
const params = new URLSearchParams(location.search);
const replayMode = document.querySelector('meta[name="demo-mode"]')?.content === "replay" || params.get("replay") === "1";
if (replayMode) document.body.classList.add("replay-mode");
let replayPromise;
let replayRecordedAt = "";
let replaySummary = "These fictional runs were recorded in October 2026. Choose a question to inspect the saved answers, memory calls, and source IDs; the dates in the answers are frozen.";
let replayTimer;
let replayScenario;
let replaySteps = [];
let replayStepIndex = 0;
let replayPaused = false;
let replayDisplay = {};

function setCardState(agent, state, message) {
  const view = cards[agent];
  view.card.dataset.state = state;
  view.card.setAttribute("aria-busy", String(state === "running"));
  view.status.dataset.state = state;
  view.status.textContent = state === "running" ? (replayMode ? "Loading replay…" : "Reading memory…") : state === "done" ? "Complete" : state === "error" ? "Unavailable" : "Ready";
  if (message) view.answer.textContent = message;
}

function lookupLabel(agent, tool, index) {
  if (tool === "get_conversation") {
    return agent === "after" && index > 0 ? "Read partner conversation" : "Read helpline conversation";
  }
  return {
    search: "Find shared entity",
    get_entity_history: "Follow entity history",
    get_entity_provenance: "Check source provenance"
  }[tool] || tool.replaceAll("_", " ");
}

function selectedSource(agent, result) {
  const kind = agent === "before" ? "helpline" : "pantry";
  return (result?.proof?.sources || []).find((source) => source.kind === kind);
}

function renderSource(agent, result) {
  const view = cards[agent];
  const source = selectedSource(agent, result);
  view.source.hidden = !source;
  if (!source) return;
  view.sourceText.textContent = source.text || "Source text unavailable.";
  view.sourceId.textContent = `Conversation ${source.conversationId || "unknown"}${source.messageId ? ` · message ${source.messageId}` : ""}`;
}

function renderCalls(agent) {
  const list = $(`${agent}-calls`);
  list.replaceChildren();
  const calls = cards[agent].result?.proof?.calls || [];
  for (const call of calls) {
    const item = document.createElement("li");
    item.textContent = `${call.tool || "memory tool"} ${JSON.stringify(call.input || {})}`;
    list.append(item);
  }
  if (!calls.length) {
    const item = document.createElement("li");
    item.textContent = "No memory calls captured.";
    list.append(item);
  }
}

function renderHistoryEvidence(records) {
  const section = $("history-evidence");
  const list = $("history-evidence-list");
  list.replaceChildren();
  section.hidden = !replayMode || !records.length;
  if (section.hidden) return;
  for (const record of records) {
    const row = document.createElement("li");
    const label = document.createElement("strong");
    label.textContent = record.kind === "pantry" ? "Pantry coordinator's conversation" : "Helpline conversation";
    const text = document.createElement("p");
    text.textContent = record.text || "Text unavailable";
    const ids = document.createElement("code");
    ids.textContent = `Conversation ${record.conversationId || "unknown"}${record.messageId ? ` · message ${record.messageId}` : ""}`;
    row.append(label, text, ids);
    list.append(row);
  }
}

function renderProof() {
  if (!cards.before.result || !cards.after.result) return;
  const before = cards.before.result;
  const after = cards.after.result;
  const helpline = selectedSource("before", before);
  const pantry = selectedSource("after", after);
  const bridge = after.proof?.bridge;
  const historyRecords = Array.isArray(bridge?.historyEvidence) ? bridge.historyEvidence : [];
  const calls = after.proof?.calls || [];
  const replayEvidenceMatches = historyRecords.some((record) => record.conversationId === helpline?.conversationId)
    && historyRecords.some((record) => record.conversationId === pantry?.conversationId)
    && calls.some((call) => call.tool === "get_entity_history" && call.input?.entity_id === bridge?.entityId)
    && calls.some((call) => call.tool === "get_conversation" && call.input?.session_id === pantry?.conversationId);
  const verified = Boolean(!before.error && !after.error && helpline && pantry && bridge?.verified
    && (!replayMode || replayEvidenceMatches));
  evidence.hidden = false;
  observedPath.hidden = !verified;
  $("replay-proof").hidden = !replayMode || !verified;
  if (replayMode && !verified) {
    errorMessage.textContent = "Recorded memory path could not be verified. Inspect the trace below.";
    errorMessage.hidden = false;
  }
  renderHistoryEvidence(historyRecords);
  proofStatus.dataset.state = verified ? "verified" : "unverified";
  proofStatus.textContent = verified ? (replayMode ? "Recorded crossing verified" : "Crossing verified") : "Crossing not verified";

  if (verified) {
    proofExplanation.textContent = `${replayMode ? `This run was recorded ${replayRecordedAt || "earlier"}. ` : ""}The captured entity-history result linked the helpline and pantry conversations. The shared-graph agent then read the pantry source message. The IDs and excerpts below come from the memory tool responses.`;
  } else {
    proofExplanation.textContent = "The captured tool results did not establish a cross-conversation path. The answer difference alone is not proof of graph use; inspect the calls below.";
  }

  if (verified) {
    $("path-helpline-id").textContent = helpline.conversationId || "ID unavailable";
    $("path-bridge-name").textContent = bridge.name || "Shared entity";
    $("path-bridge-id").textContent = bridge.entityId || "ID unavailable";
    $("path-pantry-id").textContent = pantry.conversationId || "ID unavailable";
  }
  renderCalls("before");
  renderCalls("after");
}

function showResult(agent, result) {
  const view = cards[agent];
  view.result = result;
  if (result.error) {
    setCardState(agent, "error", result.error);
    view.time.textContent = "—";
    view.steps.replaceChildren();
    view.source.hidden = true;
    view.outcome.hidden = true;
    renderProof();
    return;
  }

  setCardState(agent, "done", result.answer.replace(/\*\*(Checked:)\*\*/gi, "$1"));
  if (replayMode) {
    const locationName = replayDisplay[agent];
    const source = selectedSource(agent, result);
    view.outcome.querySelector("strong").textContent = locationName || "";
    view.outcome.hidden = !(locationName && source?.text?.includes(locationName) && result.answer.includes(locationName));
    const accessQuestion = prompt.value.toLowerCase().includes("wheelchair accessible");
    let outcomeLabel = agent === "before" ? "OLDER HELPLINE NOTE" : "PANTRY MOVE NOTICE";
    if (accessQuestion && agent === "before" && result.answer.includes("don't have any information")) {
      outcomeLabel = "ACCESS NOT CONFIRMED";
    } else if (accessQuestion && agent === "after" && result.answer.includes("step-free entrance")) {
      outcomeLabel = "STEP-FREE ACCESS FOUND";
    }
    view.outcome.querySelector("small").textContent = outcomeLabel;
    view.detail.open = false;
  }
  view.time.textContent = `${Number(result.seconds).toFixed(1)}s`;
  view.steps.replaceChildren();
  (result.tools || []).forEach((tool, index) => {
    const item = document.createElement("li");
    item.textContent = lookupLabel(agent, String(tool), index);
    view.steps.append(item);
  });
  if (!view.steps.children.length) {
    const item = document.createElement("li");
    item.className = "placeholder";
    item.textContent = "No memory lookups recorded";
    view.steps.append(item);
  }
  renderSource(agent, result);
  renderProof();
}

async function runAgent(agent, question) {
  try {
    const response = await fetch(`/api/run/${agent}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: question })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "The agent request failed.");
    showResult(agent, result);
  } catch (error) {
    showResult(agent, { error: error instanceof Error ? error.message : "The agent request failed." });
  }
}

async function loadReplay() {
  if (!replayPromise) {
    replayPromise = (async () => {
      const response = await fetch("./replay.json", { cache: "no-store" });
      if (!response.ok) throw new Error("Recorded runs are unavailable.");
      const data = await response.json();
      if (!Array.isArray(data.scenarios) || !data.scenarios.length) {
        throw new Error("Recorded runs are unavailable.");
      }
      const dates = [...new Set(data.scenarios.map((item) => item.recordedAt?.slice(0, 10)).filter(Boolean))];
      replaySummary = `Captured ${dates.join(" and ") || "on an unknown date"} UTC with real agents and Neo4j Agent Memory. Choose a question to inspect the saved memory evidence; dates in these fictional answers are frozen.`;
      replayNote.textContent = replaySummary;
      if (typeof data.traceEventsFile === "string" && /^[a-z0-9._-]+\.json$/i.test(data.traceEventsFile)) {
        $("trace-events-link").href = `./${data.traceEventsFile}`;
        $("trace-events-link").hidden = false;
      }
      if (typeof data.graphProofFile === "string" && /^[a-z0-9._-]+\.json$/i.test(data.graphProofFile)) {
        $("graph-proof-link").href = `./${data.graphProofFile}`;
        $("graph-proof-link").hidden = false;
      }
      return data.scenarios;
    })().catch((error) => {
      replayPromise = undefined;
      throw error;
    });
  }
  return replayPromise;
}

function shortId(value) {
  return value ? `${String(value).slice(0, 8)}…` : "";
}

function traceNode(kind, state, name, id) {
  $(`trace-${kind}`).dataset.state = state;
  $(`trace-${kind}-name`).textContent = name;
  $(`trace-${kind}-id`).textContent = shortId(id);
  $(`trace-${kind}-id`).title = id || "";
}

function resetTrace() {
  clearTimeout(replayTimer);
  replayTimer = undefined;
  replayScenario = undefined;
  replaySteps = [];
  replayStepIndex = 0;
  replayPaused = false;
  $("trace-player").hidden = true;
  $("trace-toggle").textContent = "Pause";
  $("trace-count").textContent = "0 / 0";
  $("trace-progress-fill").style.width = "0%";
  $("trace-agent").textContent = "Waiting for recorded calls";
  $("trace-call").textContent = "";
  $("trace-finding").textContent = "";
  $("trace-receipts").replaceChildren();
  traceNode("helpline", "waiting", "—", "");
  traceNode("entity", "waiting", "—", "");
  traceNode("pantry", "waiting", "—", "");
  $("trace-link-one").dataset.state = "waiting";
  $("trace-link-two").dataset.state = "waiting";
}

function replayCallText(call) {
  const input = Object.entries(call.input || {}).map(([key, value]) => {
    const text = Array.isArray(value) ? value.join(", ") : String(value);
    return `${key}: ${/^[0-9a-f]{8}-/.test(text) ? shortId(text) : text}`;
  }).join(" · ");
  return `${call.tool || "memory tool"}(${input})`;
}

function renderTraceReceipts(messages, helplineId, pantryId) {
  const container = $("trace-receipts");
  container.replaceChildren();
  for (const message of messages || []) {
    const row = document.createElement("div");
    const label = document.createElement("strong");
    label.textContent = message.conversationId === helplineId ? "Helpline source"
      : message.conversationId === pantryId ? "Pantry source" : "Returned message";
    const excerpt = document.createElement("p");
    excerpt.textContent = message.text || "Source text unavailable";
    const ids = document.createElement("code");
    ids.textContent = `conversation ${message.conversationId || "unknown"}${message.messageId ? ` · message ${message.messageId}` : ""}`;
    row.append(label, excerpt, ids);
    container.append(row);
  }
}

function renderEntityReceipt(receipt) {
  if (!receipt.entityId) return;
  const row = document.createElement("div");
  const label = document.createElement("strong");
  label.textContent = receipt.entityName || "Found entity";
  const id = document.createElement("code");
  id.textContent = `entity ${receipt.entityId}`;
  row.append(label, id);
  $("trace-receipts").append(row);
}

function relevantPantryMessage(messages, question) {
  const cue = /wheelchair|accessible/i.test(question)
    ? /step-free|elevator|accessible/i : /moves|Saturday/i;
  return messages?.find((message) => cue.test(message.text || "")) || messages?.[0];
}

function advanceReplay() {
  if (!replayScenario || replayStepIndex >= replaySteps.length) return;
  const step = replaySteps[replayStepIndex++];
  const { before, after } = replayScenario.results;
  const helpline = selectedSource("before", before);
  const pantry = selectedSource("after", after);
  const bridge = after.proof?.bridge;
  const history = Array.isArray(bridge?.historyEvidence) ? bridge.historyEvidence : [];
  const bothInHistory = history.some((item) => item.conversationId === helpline?.conversationId)
    && history.some((item) => item.conversationId === pantry?.conversationId);
  $("trace-count").textContent = `${replayStepIndex} / ${replaySteps.length}`;
  $("trace-progress-fill").style.width = `${100 * replayStepIndex / replaySteps.length}%`;
  $("trace-agent").textContent = step.agent === "both" ? "BOTH AGENTS · SAME KNOWN ID"
    : step.agent === "before" ? "SILOED MEMORY" : "SHARED GRAPH";
  $("trace-call").textContent = `${step.agent === "both" ? "2 × " : ""}${replayCallText(step.call)}`;
  $("trace-call").title = JSON.stringify(step.call.input || {});
  const receipt = step.call.receipt || {};
  $("trace-finding").textContent = receipt.summary || "";
  renderTraceReceipts(receipt.messages, helpline?.conversationId, pantry?.conversationId);

  if ((step.agent === "before" || step.agent === "both") && step.call.tool === "get_conversation"
      && step.call.input?.session_id === helpline?.conversationId) {
    $("trace-finding").textContent = step.agent === "both"
      ? "One known conversation ID finds the old note. Only the graph agent continues."
      : receipt.summary || "Returned the helpline source.";
    if (!receipt.messages?.length) renderTraceReceipts([helpline], helpline.conversationId, pantry?.conversationId);
    traceNode("helpline", "read", replayDisplay.before, helpline.conversationId);
    showResult("before", before);
  } else if (step.agent === "after" && step.call.tool === "get_conversation"
      && step.call.input?.session_id === helpline?.conversationId) {
    if (!receipt.summary) $("trace-finding").textContent = "Read the same helpline note.";
    if (!receipt.messages?.length) renderTraceReceipts([helpline], helpline.conversationId, pantry?.conversationId);
  } else if (step.agent === "after" && step.call.tool === "search"
      && receipt.entityId === bridge?.entityId) {
    renderEntityReceipt(receipt);
    traceNode("entity", "found", receipt.entityName || bridge.name || "Shared entity", receipt.entityId);
  } else if (step.agent === "after" && step.call.tool === "get_entity_history"
      && step.call.input?.entity_id === bridge?.entityId && bothInHistory) {
    if (!receipt.summary) $("trace-finding").textContent = "History links the two conversations.";
    if (!receipt.messages?.length) renderTraceReceipts(history, helpline.conversationId, pantry.conversationId);
    traceNode("entity", "read", bridge.name || "Shared entity", bridge.entityId);
    traceNode("pantry", "linked", "Linked conversation", pantry.conversationId);
    $("trace-link-one").dataset.state = "read";
    $("trace-link-two").dataset.state = "read";
  } else if (step.agent === "after" && step.call.tool === "get_conversation"
      && step.call.input?.session_id === pantry?.conversationId) {
    if (!receipt.summary) $("trace-finding").textContent = "Returned the newer pantry source.";
    const relevantMessage = relevantPantryMessage(receipt.messages, replayScenario.question);
    renderTraceReceipts([relevantMessage || pantry], helpline?.conversationId, pantry.conversationId);
    traceNode("pantry", "read", replayDisplay.after, pantry.conversationId);
    showResult("after", after);
  }

  if (replayStepIndex === replaySteps.length) {
    if (!cards.before.result) showResult("before", before);
    if (!cards.after.result) showResult("after", after);
    $("trace-toggle").textContent = "Replay";
  } else if (!replayPaused) {
    replayTimer = setTimeout(advanceReplay, 1250);
  }
}

function startReplay(scenario) {
  resetTrace();
  replayScenario = scenario;
  replayDisplay = scenario.display || {};
  const beforeCalls = scenario.results.before.proof?.calls || [];
  const afterCalls = scenario.results.after.proof?.calls || [];
  const sharedFirstRead = beforeCalls[0]?.tool === "get_conversation"
    && afterCalls[0]?.tool === "get_conversation"
    && beforeCalls[0].input?.session_id === afterCalls[0].input?.session_id;
  const bridgeId = scenario.results.after.proof?.bridge?.entityId;
  const helplineId = selectedSource("before", scenario.results.before)?.conversationId;
  const pantryId = selectedSource("after", scenario.results.after)?.conversationId;
  const search = afterCalls.find((call) => call.tool === "search" && call.receipt?.entityId === bridgeId);
  const history = afterCalls.find((call) => call.tool === "get_entity_history" && call.input?.entity_id === bridgeId);
  const pantryRead = afterCalls.find((call) => call.tool === "get_conversation" && call.input?.session_id === pantryId);
  const displayMatches = ["before", "after"].every((agent) => {
    const label = replayDisplay[agent];
    const result = scenario.results[agent];
    return typeof label === "string" && selectedSource(agent, result)?.text?.includes(label)
      && result.answer.includes(label);
  });
  if (!sharedFirstRead || !search || !history || !pantryRead || !displayMatches
      || !history.receipt?.conversationIds?.includes(helplineId)
      || !history.receipt.conversationIds.includes(pantryId)) {
    throw new Error("This recording is missing a key memory read.");
  }
  replaySteps = [
    { agent: "both", call: beforeCalls[0] },
    { agent: "after", call: search },
    { agent: "after", call: history },
    { agent: "after", call: pantryRead }
  ];
  $("trace-player").hidden = false;
  $("trace-count").textContent = `0 / ${replaySteps.length}`;
  replayTimer = setTimeout(advanceReplay, 450);
}

async function compare(event) {
  event.preventDefault();
  if (running) return;
  const question = prompt.value.trim();
  if (!question) {
    errorMessage.textContent = "Enter a question first.";
    errorMessage.hidden = false;
    prompt.focus();
    return;
  }

  running = true;
  errorMessage.hidden = true;
  evidence.hidden = true;
  $("replay-proof").hidden = true;
  if (replayMode) {
    resetTrace();
    $("evidence-detail").open = false;
  }
  prompt.disabled = true;
  examples.forEach((button) => { button.disabled = true; });
  runButton.disabled = true;
  runButton.querySelector("span").textContent = replayMode ? "Loading replay…" : "Running…";
  for (const agent of Object.keys(cards)) {
    cards[agent].result = null;
    setCardState(agent, "running", replayMode ? "Loading the recorded answer…" : "Checking memory for this question…");
    cards[agent].time.textContent = "—";
    cards[agent].steps.replaceChildren();
    cards[agent].source.hidden = true;
    cards[agent].outcome.hidden = true;
    if (replayMode) cards[agent].detail.open = false;
  }

  try {
    if (replayMode) {
      const scenarios = await loadReplay();
      const scenario = scenarios.find((item) => item.question === question);
      if (!scenario?.results?.before || !scenario?.results?.after) {
        throw new Error("Choose one of the recorded questions above.");
      }
      replayRecordedAt = typeof scenario.recordedAt === "string" ? `${scenario.recordedAt.slice(0, 10)} UTC` : "an unknown date";
      replayNote.textContent = `Recorded ${replayRecordedAt} with real agents and Neo4j Agent Memory. Dates in these fictional answers are frozen; choose another question to compare the saved runs.`;
      $("replay-question").textContent = `“${scenario.question}”`;
      $("replay-question").hidden = false;
      startReplay(scenario);
    } else {
      await Promise.all([runAgent("before", question), runAgent("after", question)]);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Recorded runs are unavailable.";
    errorMessage.textContent = message;
    errorMessage.hidden = false;
    evidence.hidden = true;
    for (const agent of Object.keys(cards)) {
      setCardState(agent, "error", message);
    }
  } finally {
    running = false;
    prompt.disabled = false;
    examples.forEach((button) => { button.disabled = false; });
    runButton.disabled = false;
    runButton.querySelector("span").textContent = replayMode ? "Play recorded comparison" : "Run comparison";
    if (!replayMode) runButton.focus();
  }
}

form.addEventListener("submit", compare);
$("trace-toggle").addEventListener("click", () => {
  if (!replayScenario) return;
  if (replayStepIndex >= replaySteps.length) {
    prompt.value = replayScenario.question;
    form.requestSubmit();
    return;
  }
  replayPaused = !replayPaused;
  $("trace-toggle").textContent = replayPaused ? "Resume" : "Pause";
  clearTimeout(replayTimer);
  if (!replayPaused) replayTimer = setTimeout(advanceReplay, 450);
});
prompt.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    form.requestSubmit();
  }
});
examples.forEach((button) => button.addEventListener("click", () => {
  prompt.value = button.dataset.question || "";
  if (replayMode) {
    replayRecordedAt = "";
    replayNote.textContent = replaySummary;
    examples.forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
    evidence.hidden = true;
    $("replay-proof").hidden = true;
    $("replay-question").textContent = `“${prompt.value}”`;
    $("replay-question").hidden = false;
    for (const agent of Object.keys(cards)) {
      cards[agent].result = null;
      setCardState(agent, "ready", "Play this recorded comparison to see the answer.");
      cards[agent].time.textContent = "—";
      cards[agent].steps.replaceChildren();
      cards[agent].source.hidden = true;
      cards[agent].outcome.hidden = true;
      cards[agent].detail.open = false;
    }
    form.requestSubmit();
    return;
  }
  prompt.focus();
}));

if (replayMode) {
  replayNote.hidden = false;
  $("intro-eyebrow").textContent = "RECORDED AGENT RUN · OCTOBER 2026";
  $("headline-first").textContent = "Silo misses the move.";
  $("headline-second").textContent = "Graph finds it.";
  $("replay-question").textContent = `“${prompt.value.trim()}”`;
  $("replay-question").hidden = false;
  $("evidence-detail").open = false;
  Object.values(cards).forEach((view) => { view.detail.open = false; });
  prompt.readOnly = true;
  prompt.setAttribute("aria-describedby", "replay-note");
  $("prompt-label").textContent = "Choose a recorded question";
  $("prompt-caption").textContent = "Same model; different retrieval instructions and permissions";
  document.querySelector(".examples").setAttribute("aria-label", "Recorded questions");
  $("evidence-eyebrow").textContent = "RECORDED MEMORY READS · SOURCE IDS";
  $("calls-summary").textContent = "Inspect the recorded memory calls and source IDs";
  $("replay-data-link").hidden = false;
  runButton.querySelector("span").textContent = "Play recorded comparison";
  examples.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.question === prompt.value.trim())));
  loadReplay().then(() => form.requestSubmit()).catch((error) => {
    errorMessage.textContent = error instanceof Error ? error.message : "Recorded runs are unavailable.";
    errorMessage.hidden = false;
  });
}
