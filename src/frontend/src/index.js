import { AuthClient } from "@dfinity/auth-client";
import { Actor, HttpAgent } from "@dfinity/agent";
import { Principal } from "@dfinity/principal";
import { idlFactory } from "../../declarations/canister-tracking-platform-backend/canister-tracking-platform-backend.did.js";

let authClient;
let actor;

// Get the canister ID from the environment
const canisterId = process.env.CANISTER_ID_CANISTER_TRACKING_PLATFORM_BACKEND || "bkyz2-fmaaa-aaaaa-qaaaq-cai";

const II_URL = process.env.DFX_NETWORK === "ic" 
    ? "https://identity.ic0.app/#authorize" 
    : `http://be2us-64aaa-aaaaa-qaabq-cai.localhost:8000/#authorize`;

async function init() {
    authClient = await AuthClient.create();
    const isAuthenticated = await authClient.isAuthenticated();

    const loginButton = document.getElementById("loginButton");
    const logoutButton = document.getElementById("logoutButton");
    const authSection = document.getElementById("auth-section");
    const userSection = document.getElementById("user-section");

    loginButton.onclick = login;
    logoutButton.onclick = logout;

    if (isAuthenticated) {
        await handleAuthenticated();
    }

    updateUI(isAuthenticated);
}

async function login() {
    const days = BigInt(1);
    const hours = BigInt(24);
    const nanoseconds = BigInt(3600000000000);

    await authClient.login({
        identityProvider: II_URL,
        maxTimeToLive: days * hours * nanoseconds,
        onSuccess: async () => {
            await handleAuthenticated();
            window.location.reload(); // Reload the page after successful authentication
        },
    });
}

async function handleAuthenticated() {
    const identity = authClient.getIdentity();
    const agent = new HttpAgent({ identity });
    
    // When deploying to IC, remove this line
    if (process.env.DFX_NETWORK !== "ic") {
        await agent.fetchRootKey();
    }

    // Create actor with the new identity
    actor = Actor.createActor(idlFactory, {
        agent,
        canisterId: canisterId,
    });

    // Display user's principal ID
    const principal = identity.getPrincipal();
    document.getElementById("principalId").textContent = principal.toString();

    // Load and display user's canisters
    await loadUserCanisters();
    startPeriodicMetricsUpdate();

    // Set up canister registration form handler
    const registerForm = document.getElementById("register-canister-form");
    registerForm.onsubmit = async (e) => {
        e.preventDefault();
        await registerCanister();
    };
}

async function loadUserCanisters() {
    try {
        const result = await actor.listUserCanisters();
        if (result.ok) {
            displayCanisters(result.ok);
        } else {
            console.error("Failed to load canisters:", result.err);
        }
    } catch (error) {
        console.error("Error loading canisters:", error);
    }
}

function displayCanisters(canisters) {
    const container = document.getElementById("canisters-container");
    container.innerHTML = "";

    if (canisters.length === 0) {
        container.innerHTML = "<p>No canisters registered yet.</p>";
        return;
    }

    canisters.forEach(([canisterId, info]) => {
        const card = document.createElement("div");
        card.className = "canister-card";
        
        const createdDate = new Date(Number(info.createdAt) / 1000000);
        const canisterIdStr = canisterId.toString();
        
        card.innerHTML = `
            <h5>${info.name}</h5>
            <p><strong>ID:</strong> ${canisterIdStr}</p>
            <p><strong>Description:</strong> ${info.description}</p>
            <p><strong>Created:</strong> ${createdDate.toLocaleDateString()}</p>
            <button onclick='window.editCanister(${JSON.stringify(canisterIdStr)}, ${JSON.stringify(info.name)}, ${JSON.stringify(info.description)})'>Edit</button>
            
            <div class="metrics-container" id="metrics-${canisterIdStr}">
                <h6>Monitoring Data</h6>
                <div class="metric-data"></div>
                <button class="refresh-button" onclick="refreshMetrics('${canisterIdStr}')">Refresh Metrics</button>
            </div>
        `;
        
        container.appendChild(card);
    });
    
    // Fetch metrics for all canisters after they're displayed
    setTimeout(() => {
        canisters.forEach(([canisterId]) => {
            fetchCanisterMetrics(canisterId.toString());
        });
    }, 100);
}

async function registerCanister() {
    const canisterId = document.getElementById("canister-id").value.trim();
    const name = document.getElementById("canister-name").value.trim();
    const description = document.getElementById("canister-description").value.trim();

    try {
        // Validate canister ID format
        if (!canisterId.match(/^[a-z0-9-]+$/)) {
            alert("Invalid canister ID format. Please enter a valid canister ID.");
            return;
        }

        // Create a Principal from the canister ID string
        const canisterPrincipal = Principal.fromText(canisterId);
        const result = await actor.registerCanister(canisterPrincipal, name, description);
        
        if ('ok' in result) {
            alert("Canister registered successfully!");
            
            // Clear the form
            document.getElementById("register-canister-form").reset();
            
            // Refresh the list and fetch metrics with retry
            await loadUserCanisters();
            
            // Add a small delay before fetching metrics to ensure canister is registered
            setTimeout(async () => {
                try {
                    await fetchCanisterMetrics(canisterId);
                } catch (error) {
                    console.error("Error fetching initial metrics:", error);
                }
            }, 1000);
        } else {
            alert("Failed to register canister: " + JSON.stringify(result.err));
        }
    } catch (error) {
        console.error("Error registering canister:", error);
        if (error.message.includes("Invalid principal")) {
            alert("Invalid canister ID format. Please check the ID and try again.");
        } else {
            alert("Error registering canister: " + error.message);
        }
    }
}

// Make editCanister function available globally
window.editCanister = async function editCanister(canisterId, currentName, currentDescription) {
    const newName = prompt("Enter new name:", currentName);
    if (!newName) return;

    const newDescription = prompt("Enter new description:", currentDescription);
    if (!newDescription) return;

    try {
        const principal = Principal.fromText(canisterId);
        const result = await actor.updateCanisterInfo(principal, newName, newDescription);
        
        // Check if 'ok' property exists in result, even if it's null
        if ('ok' in result) {
            alert("Canister updated successfully!");
            await loadUserCanisters(); // Refresh the list
        } else {
            alert("Failed to update canister: " + JSON.stringify(result.err));
        }
    } catch (error) {
        console.error("Error updating canister:", error);
        alert("Error updating canister: " + error.message);
    }
}

async function logout() {
    await authClient.logout();
    actor = null;
    // Clear any periodic updates
    if (window.metricsUpdateInterval) {
        clearInterval(window.metricsUpdateInterval);
        window.metricsUpdateInterval = null;
    }
    updateUI(false);
    // Force a page reload to ensure clean state
    window.location.reload();
}

function updateUI(isAuthenticated) {
    const authSection = document.getElementById("auth-section");
    const userSection = document.getElementById("user-section");
    
    if (isAuthenticated) {
        authSection.style.display = "none";
        userSection.style.display = "block";
    } else {
        authSection.style.display = "block";
        userSection.style.display = "none";
        document.getElementById("principalId").textContent = "";
    }
}

// Update monitoring functions
async function fetchCanisterMetrics(canisterId, retryCount = 0) {
    try {
        if (!actor) {
            console.warn("Actor not initialized yet");
            return;
        }

        const principal = Principal.fromText(canisterId);
        
        // First update the metrics
        const updateResult = await actor.updateCanisterMetrics(principal);
        if ('err' in updateResult) {
            console.error("Failed to update metrics:", updateResult.err);
            
            // If the error is due to canister not being ready, retry after a delay
            if (retryCount < 3 && updateResult.err === 'UpdateFailed') {
                setTimeout(() => {
                    fetchCanisterMetrics(canisterId, retryCount + 1);
                }, 2000 * (retryCount + 1)); // Exponential backoff
            }
            return;
        }

        // Then fetch the updated metrics
        const result = await actor.getCanisterMetrics(principal);
        if (result.ok) {
            displayMetrics(canisterId, result.ok);
        } else {
            console.error("Failed to fetch metrics:", result.err);
        }
    } catch (error) {
        console.error("Error fetching metrics:", error);
        
        // If it's a principal error, don't retry
        if (!error.message.includes("Invalid principal") && retryCount < 3) {
            setTimeout(() => {
                fetchCanisterMetrics(canisterId, retryCount + 1);
            }, 2000 * (retryCount + 1)); // Exponential backoff
        }
    }
}

function displayMetrics(canisterId, metrics) {
    const metricsContainer = document.querySelector(`#metrics-${canisterId} .metric-data`);
    if (!metricsContainer) return;

    const lastUpdated = new Date(Number(metrics.lastUpdated) / 1000000);
    const createdAt = new Date(Number(metrics.createdAt) / 1000000);
    
    metricsContainer.innerHTML = `
        <div class="metric-item">
            <span class="metric-label">Memory Usage:</span>
            ${formatBytes(metrics.memorySize)}
        </div>
        <div class="metric-item">
            <span class="metric-label">Available Cycles:</span>
            ${formatNumber(metrics.cycles)}
        </div>
        <div class="metric-item">
            <span class="metric-label">Storage Utilization:</span>
            ${formatBytes(metrics.storageUtilization)}
        </div>
        <div class="metric-item">
            <span class="metric-label">Module Hash:</span>
            ${metrics.moduleHash ? Array.from(metrics.moduleHash).map(b => b.toString(16).padStart(2, '0')).join('') : 'Not available'}
        </div>
        <div class="metric-item">
            <span class="metric-label">Controllers:</span>
            <div class="controllers-list">
                ${metrics.controllers.map(controller => `<div class="controller">${controller.toString()}</div>`).join('')}
            </div>
        </div>
        <div class="metric-item">
            <span class="metric-label">Status:</span>
            <span class="status-badge status-${metrics.status.toLowerCase()}">${metrics.status}</span>
        </div>
        <div class="metric-item">
            <span class="metric-label">Compute Allocation:</span>
            ${Number(metrics.computeAllocation)}%
        </div>
        <div class="metric-item">
            <span class="metric-label">Freezing Threshold:</span>
            ${formatNumber(metrics.freezingThreshold)} seconds
        </div>
        <div class="metric-item">
            <span class="metric-label">Creation Time:</span>
            ${createdAt.toLocaleString()}
        </div>
        <div class="metric-item">
            <span class="metric-label">Subnet ID:</span>
            ${metrics.subnetId ? metrics.subnetId.toString() : 'Not available'}
        </div>
        <div class="metric-item">
            <span class="metric-label">Last Updated:</span>
            ${lastUpdated.toLocaleString()}
        </div>
    `;

    // Add some styling for status badges
    const style = document.createElement('style');
    style.textContent = `
        .metric-item {
            margin-bottom: 10px;
            padding: 8px;
            border-radius: 4px;
            background: #f5f5f5;
        }
        .metric-label {
            font-weight: bold;
            color: #333;
            margin-right: 8px;
        }
        .status-badge {
            padding: 4px 8px;
            border-radius: 12px;
            font-size: 0.9em;
            font-weight: 500;
        }
        .status-running {
            background: #e6ffe6;
            color: #006600;
        }
        .status-stopping {
            background: #fff3e6;
            color: #cc6600;
        }
        .status-stopped {
            background: #ffe6e6;
            color: #cc0000;
        }
        .controllers-list {
            margin-top: 5px;
            font-family: monospace;
            font-size: 0.9em;
        }
        .controller {
            padding: 4px;
            background: #e6e6e6;
            margin: 2px 0;
            border-radius: 4px;
            word-break: break-all;
        }
    `;
    document.head.appendChild(style);
}

function formatBytes(bytes) {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = Number(bytes);
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }
    
    return `${size.toFixed(2)} ${units[unitIndex]}`;
}

function formatNumber(num) {
    return new Intl.NumberFormat().format(Number(num));
}

// Add to window object for HTML access
window.refreshMetrics = fetchCanisterMetrics;

// Add periodic metrics update (every 8 hours)
function startPeriodicMetricsUpdate() {
    const EIGHT_HOURS = 8 * 60 * 60 * 1000; // 8 hours in milliseconds
    
    async function updateAllMetrics() {
        try {
            if (!actor) {
                console.warn("Actor not initialized yet");
                return;
            }

            const result = await actor.listUserCanisters();
            if (result.ok) {
                for (const [canisterId] of result.ok) {
                    await fetchCanisterMetrics(canisterId.toString());
                }
            }
        } catch (error) {
            console.error("Error updating metrics:", error);
        }
    }
    
    // Clear any existing interval
    if (window.metricsUpdateInterval) {
        clearInterval(window.metricsUpdateInterval);
    }
    
    // Set up periodic updates
    window.metricsUpdateInterval = setInterval(updateAllMetrics, EIGHT_HOURS);
}

init();
