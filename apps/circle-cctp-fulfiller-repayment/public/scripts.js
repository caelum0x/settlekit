/**
 * Copyright 2026 Circle Internet Group, Inc.  All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

const runState = document.querySelector("#runState");
const commandOutput = document.querySelector("#commandOutput");
const currentStatus = document.querySelector("#currentStatus");
const selectedFulfiller = document.querySelector("#selectedFulfiller");
const intentId = document.querySelector("#intentId");
const recipient = document.querySelector("#recipient");
const amount = document.querySelector("#amount");
const priority = document.querySelector("#priority");
const fulfillerAddress = document.querySelector("#fulfillerAddress");
const fulfillTx = document.querySelector("#fulfillTx");
const repaymentRegistrationTx = document.querySelector(
  "#repaymentRegistrationTx",
);
const sourceTx = document.querySelector("#sourceTx");
const mintTx = document.querySelector("#mintTx");
const repaymentTx = document.querySelector("#repaymentTx");
const logsList = document.querySelector("#logsList");
const platformBalance = document.querySelector("#platformBalance");
const selectedFulfillerBalance = document.querySelector(
  "#selectedFulfillerBalance",
);
const contractorBalance = document.querySelector("#contractorBalance");
const repaymentContractBalance = document.querySelector(
  "#repaymentContractBalance",
);

const stepIntent = document.querySelector("#stepIntent");
const stepFulfill = document.querySelector("#stepFulfill");
const stepSettle = document.querySelector("#stepSettle");
const stepRepaid = document.querySelector("#stepRepaid");
const actionButtons = Array.from(document.querySelectorAll("button"));
let pollTimer = null;
const explorers = {
  source: "https://testnet.arcscan.app/tx/",
  destination: "https://sepolia.etherscan.io/tx/",
};

function markStep(element, active) {
  element.textContent = active
    ? `${element.dataset.base} ✅`
    : element.dataset.base;
}

function resetStepLabels() {
  [stepIntent, stepFulfill, stepSettle, stepRepaid].forEach((element) => {
    if (!element.dataset.base) {
      element.dataset.base = element.textContent;
    }
    markStep(element, false);
  });
}

function updateSteps(record) {
  resetStepLabels();
  if (!record) return;
  markStep(
    stepIntent,
    [
      "intent_created",
      "payout_sent",
      "fulfilled",
      "settlement_pending",
      "mint_completed",
      "repaid",
    ].includes(record.status),
  );
  markStep(
    stepFulfill,
    ["payout_sent", "fulfilled", "settlement_pending", "mint_completed", "repaid"].includes(
      record.status,
    ),
  );
  markStep(
    stepSettle,
    Boolean(record.sourceTxHash || record.mintTxHash || record.repaymentTxHash),
  );
  markStep(stepRepaid, record.status === "repaid");
}

function setExplorerLink(element, hash, explorerBaseUrl) {
  if (!hash) {
    element.textContent = "-";
    return;
  }

  const link = document.createElement("a");
  link.href = `${explorerBaseUrl}${hash}`;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = hash;
  element.replaceChildren(link);
}

function renderRecord(record) {
  currentStatus.textContent = record?.status ?? "-";
  selectedFulfiller.textContent = record?.selectedFulfiller ?? "-";
  intentId.textContent = record?.intentId ?? "-";
  recipient.textContent = record?.recipient ?? "-";
  amount.textContent = record?.amountUsdc ? `${record.amountUsdc} USDC` : "-";
  priority.textContent = record?.priority ?? "-";
  fulfillerAddress.textContent = record?.fulfillerAddress ?? "-";
  setExplorerLink(fulfillTx, record?.fulfillTxHash, explorers.destination);
  setExplorerLink(
    repaymentRegistrationTx,
    record?.repaymentRegistrationTxHash,
    explorers.destination,
  );
  setExplorerLink(sourceTx, record?.sourceTxHash, explorers.source);
  setExplorerLink(mintTx, record?.mintTxHash, explorers.destination);
  setExplorerLink(repaymentTx, record?.repaymentTxHash, explorers.destination);

  logsList.innerHTML = "";
  const logs = record?.logs ?? [];
  if (logs.length === 0) {
    const item = document.createElement("li");
    item.textContent = "No logs yet.";
    logsList.appendChild(item);
  } else {
    logs.forEach((line) => {
      const item = document.createElement("li");
      item.textContent = line;
      logsList.appendChild(item);
    });
  }

  updateSteps(record);
}

function renderBalances(balances) {
  platformBalance.textContent = balances?.platformSourceUsdc ?? "-";
  selectedFulfillerBalance.textContent =
    balances?.selectedFulfillerDestinationUsdc ?? "-";
  contractorBalance.textContent = balances?.contractorDestinationUsdc ?? "-";
  repaymentContractBalance.textContent =
    balances?.repaymentContractDestinationUsdc ?? "-";
}

async function refreshStatus() {
  const [statusResponse, balancesResponse] = await Promise.all([
    fetch("/api/status"),
    fetch("/api/balances"),
  ]);
  const data = await statusResponse.json();
  renderRecord(data.intents.at(-1));
  if (balancesResponse.ok) {
    const balances = await balancesResponse.json();
    renderBalances(balances);
  }
  runState.textContent = data.isRunningAction
    ? "A command is running…"
    : "Idle.";
  return data;
}

function setActionsDisabled(disabled) {
  actionButtons.forEach((button) => {
    button.disabled = disabled;
  });
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = window.setInterval(async () => {
    try {
      const data = await refreshStatus();
      if (!data.isRunningAction && pollTimer) {
        window.clearInterval(pollTimer);
        pollTimer = null;
        setActionsDisabled(false);
      }
    } catch {
      runState.textContent = "Polling failed, retrying…";
    }
  }, 750);
}

function stopPolling() {
  if (!pollTimer) return;
  window.clearInterval(pollTimer);
  pollTimer = null;
}

async function runAction(action, body = undefined) {
  runState.textContent = `Running ${action}…`;
  if (action === "intent") {
    commandOutput.textContent = "";
  }
  setActionsDisabled(true);
  startPolling();

  const response = await fetch(`/api/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();

  if (!response.ok) {
    stopPolling();
    setActionsDisabled(false);
    runState.textContent = "Command failed.";
    commandOutput.textContent = data.error ?? "Unknown error";
    return;
  }

  stopPolling();
  setActionsDisabled(false);
  await refreshStatus();
  const stderr = data.stderr ? `\n\nstderr:\n${data.stderr}` : "";
  commandOutput.textContent =
    `${data.stdout}${stderr}`.trim() || "Command completed with no output.";
  runState.textContent = `${action} complete.`;
}

document
  .querySelector("#intentForm")
  .addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await runAction("intent", {
      recipient: form.get("recipient"),
      amountUsdc: form.get("amountUsdc"),
      priority: form.get("priority"),
      maxFeeBps: form.get("maxFeeBps"),
    });
  });

document.querySelectorAll("[data-action]").forEach((button) => {
  button.addEventListener("click", () => runAction(button.dataset.action));
});

document
  .querySelector("#refreshButton")
  .addEventListener("click", refreshStatus);

refreshStatus().catch((error) => {
  runState.textContent = "Unable to load status.";
  commandOutput.textContent =
    error instanceof Error ? error.message : String(error);
});
