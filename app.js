const $ = (id) => document.getElementById(id);
const form = $("prompt-form");
const prompt = $("prompt");
const runButton = $("run-button");
const errorMessage = $("form-error");
const evidence = $("evidence");
const previewBadge = $("preview-badge");
const replayBadge = $("replay-badge");
const replayNote = $("replay-note");
const proofStatus = $("proof-status");
const proofExplanation = $("proof-explanation");
const observedPath = $("observed-path");
const examples = [...document.querySelectorAll("[data-question]")];
const cards = {
  before: { card: $("before-card"), status: $("before-status"), answer: $("before-answer"), steps: $("before-steps"), time: $("before-time"), source: $("before-source"), sourceText: $("before-source-text"), sourceId: $("before-source-id"), result: null },
  after: { card: $("after-card"), status: $("after-status"), answer: $("after-answer"), steps: $("after-steps"), time: $("after-time"), source: $("after-source"), sourceText: $("after-source-text"), sourceId: $("after-source-id"), result: null }
};

let running = false;
const params = new URLSearchParams(location.search);
const replayMode = document.querySelector('meta[name="demo-mode"]')?.content === "replay" || params.get("replay") === "1";
let previewMode = !replayMode && params.get("preview") === "1";
let replayPromise;
let replayRecordedAt = "";
let replaySummary = "These fictional runs were recorded in October 2026. Choose a question to inspect the saved answers, memory calls, and source IDs; the dates in the answers are frozen.";

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
  renderHistoryEvidence(historyRecords);
  proofStatus.dataset.state = previewMode ? "preview" : verified ? "verified" : "unverified";
  proofStatus.textContent = previewMode ? "Sample proof layout" : verified ? (replayMode ? "Recorded crossing verified" : "Crossing verified") : "Crossing not verified";

  if (previewMode) {
    proofExplanation.textContent = "This is sample content to show the layout. Run a comparison to inspect real memory tool results.";
  } else if (verified) {
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
    renderProof();
    return;
  }

  setCardState(agent, "done", result.answer.replace(/\*\*(Checked:)\*\*/gi, "$1"));
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
      return data.scenarios;
    })().catch((error) => {
      replayPromise = undefined;
      throw error;
    });
  }
  return replayPromise;
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
  previewMode = false;
  errorMessage.hidden = true;
  previewBadge.hidden = true;
  evidence.hidden = true;
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
      showResult("before", scenario.results.before);
      showResult("after", scenario.results.after);
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
    runButton.focus();
  }
}

form.addEventListener("submit", compare);
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
    for (const agent of Object.keys(cards)) {
      cards[agent].result = null;
      setCardState(agent, "ready", "Play this recorded comparison to see the answer.");
      cards[agent].time.textContent = "—";
      cards[agent].steps.replaceChildren();
      cards[agent].source.hidden = true;
    }
  }
  prompt.focus();
}));

if (replayMode) {
  replayBadge.hidden = false;
  replayNote.hidden = false;
  prompt.readOnly = true;
  prompt.setAttribute("aria-describedby", "replay-note");
  $("prompt-label").textContent = "Choose a recorded question";
  $("prompt-caption").textContent = "Same model and question, two memory scopes";
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

if (previewMode) {
  previewBadge.hidden = false;
  showResult("before", {
    answer: "Wrenfield Pantry gives out free groceries this Saturday morning at Brightwater Hall. It is one block from the nearest bus stop.",
    tools: ["get_conversation"], seconds: 18.4,
    proof: {
      calls: [{ tool: "get_conversation", input: { session_id: "1679b2a3-2dff-4830-a73d-a009cc7ddafa" } }],
      sources: [{ kind: "helpline", conversationId: "1679b2a3-2dff-4830-a73d-a009cc7ddafa", messageId: "sample", text: "Wrenfield Pantry gives out free groceries tomorrow morning at Brightwater Hall." }],
      bridge: null
    }
  });
  showResult("after", {
    answer: "Wrenfield Pantry holds its Saturday distribution at the Alder Branch Library community room from 10 AM to 1 PM. The library has a step-free entrance and an elevator.\n\nChecked: pantry coordination conversation, October 14, 2026.",
    tools: ["get_conversation", "search", "get_entity_history", "get_conversation"], seconds: 29.7,
    proof: {
      calls: [
        { tool: "get_conversation", input: { session_id: "1679b2a3-2dff-4830-a73d-a009cc7ddafa" } },
        { tool: "search", input: { query: "Wrenfield Pantry", memory_types: ["entities"] } },
        { tool: "get_entity_history", input: { entity_id: "sample" } },
        { tool: "get_conversation", input: { session_id: "794dc0ab-2c26-483d-988e-ea08fbb5ae73" } }
      ],
      sources: [{ kind: "pantry", conversationId: "794dc0ab-2c26-483d-988e-ea08fbb5ae73", messageId: "sample", text: "Starting Saturday, October 17, the Wrenfield Pantry Saturday distribution moves to the Alder Branch Library community room. Same hours, 10 AM to 1 PM, through December 31." }],
      bridge: { name: "Wrenfield Pantry", entityId: "sample", verified: true }
    }
  });
}
