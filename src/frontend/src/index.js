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
        
        card.innerHTML = `
            <h5>${info.name}</h5>
            <p><strong>ID:</strong> ${canisterId.toString()}</p>
            <p><strong>Description:</strong> ${info.description}</p>
            <p><strong>Created:</strong> ${createdDate.toLocaleDateString()}</p>
            <button onclick='window.editCanister(${JSON.stringify(canisterId.toString())}, ${JSON.stringify(info.name)}, ${JSON.stringify(info.description)})'>Edit</button>
            
            <div class="metrics-container" id="metrics-${canisterId.toString()}">
                <h6>Monitoring Data</h6>
                <div class="metric-data"></div>
                <button class="refresh-button" onclick='window.refreshMetrics(${JSON.stringify(canisterId.toString())})'>Refresh Metrics</button>
            </div>
        `;
        
        container.appendChild(card);
        
        // Fetch initial metrics
        fetchCanisterMetrics(canisterId.toString());
    });
}

async function registerCanister() {
    const canisterId = document.getElementById("canister-id").value;
    const name = document.getElementById("canister-name").value;
    const description = document.getElementById("canister-description").value;

    try {
        // Create a Principal from the canister ID string
        const canisterPrincipal = Principal.fromText(canisterId);
        const result = await actor.registerCanister(canisterPrincipal, name, description);
        
        // The backend returns #ok(()) for success, which becomes { ok: null } in JavaScript
        // So we check if result.ok is not undefined (even if it's null)
        if ('ok' in result) {
            alert("Canister registered successfully!");
            await loadUserCanisters(); // Refresh the list
            // Clear the form
            document.getElementById("register-canister-form").reset();
        } else {
            alert("Failed to register canister: " + JSON.stringify(result.err));
        }
    } catch (error) {
        console.error("Error registering canister:", error);
        alert("Error registering canister: " + error.message);
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
    updateUI(false);
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
async function fetchCanisterMetrics(canisterId) {
    try {
        const principal = Principal.fromText(canisterId);
        
        // First update the metrics
        const updateResult = await actor.updateCanisterMetrics(principal);
        if (!('ok' in updateResult)) {
            console.error("Failed to update metrics:", updateResult.err);
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
    }
}

function displayMetrics(canisterId, metrics) {
    const metricsContainer = document.querySelector(`#metrics-${canisterId} .metric-data`);
    if (!metricsContainer) return;

    const lastUpdated = new Date(Number(metrics.lastUpdated) / 1000000);
    
    metricsContainer.innerHTML = `
        <div class="metric-item">
            <span class="metric-label">Memory Size:</span>
            ${formatBytes(metrics.memorySize)}
        </div>
        <div class="metric-item">
            <span class="metric-label">Cycles:</span>
            ${formatNumber(metrics.cycles)}
        </div>
        <div class="metric-item">
            <span class="metric-label">Status:</span>
            ${metrics.status}
        </div>
        <div class="metric-item">
            <span class="metric-label">Compute Allocation:</span>
            ${Number(metrics.computeAllocation)}%
        </div>
        <div class="metric-item">
            <span class="metric-label">Freezing Threshold:</span>
            ${formatNumber(metrics.freezingThreshold)}
        </div>
        <div class="metric-item">
            <span class="metric-label">Last Updated:</span>
            ${lastUpdated.toLocaleString()}
        </div>
    `;
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
            const result = await actor.listUserCanisters();
            if (result.ok) {
                result.ok.forEach(([canisterId, _]) => {
                    fetchCanisterMetrics(canisterId.toString());
                });
            }
        } catch (error) {
            console.error("Error updating metrics:", error);
        }
    }
    
    // Initial update
    updateAllMetrics();
    
    // Set up periodic updates
    setInterval(updateAllMetrics, EIGHT_HOURS);
}

init();
