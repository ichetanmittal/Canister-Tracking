import { AuthClient } from "@dfinity/auth-client";
import { Actor, HttpAgent } from "@dfinity/agent";
import { Principal } from "@dfinity/principal";
import { idlFactory } from "../../declarations/canister-tracking-platform-backend/canister-tracking-platform-backend.did.js";

let authClient;
let actor;

// Get the canister ID from the environment
const canisterId = process.env.CANISTER_ID_CANISTER_TRACKING_PLATFORM_BACKEND || "42xyq-zqaaa-aaaag-at2sq-cai";  // Production/IC network ID

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
    const logoutSection = document.getElementById("logout-section");

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

    // Load user data
    await Promise.all([
        loadUserCanisters(),
        loadRules(),
        loadICPBalance()
    ]);

    startPeriodicMetricsUpdate();

    // Set up form handlers
    const registerForm = document.getElementById("register-canister-form");
    registerForm.onsubmit = async (e) => {
        e.preventDefault();
        await registerCanister();
    };

    // Start periodic rule checking
    startPeriodicRuleCheck();
}

async function loadUserCanisters() {
    try {
        console.log("Loading user canisters...");
        const result = await actor.listUserCanisters();
        console.log("User canisters result:", result);
        
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
    console.log("Displaying canisters:", canisters);
    const container = document.getElementById("canisters-container");
    const ruleCanisterSelect = document.getElementById("rule-canister");
    
    container.innerHTML = "";
    ruleCanisterSelect.innerHTML = "<option value=''>Select a canister</option>";

    if (canisters.length === 0) {
        container.innerHTML = "<p>No canisters registered yet.</p>";
        return;
    }

    canisters.forEach(([canisterId, info]) => {
        console.log("Processing canister:", canisterId.toString(), info);
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

        // Add canister to the rule creation dropdown
        const option = document.createElement("option");
        option.value = canisterIdStr;
        option.textContent = `${info.name} (${canisterIdStr})`;
        ruleCanisterSelect.appendChild(option);
    });
    
    // Fetch metrics for all canisters after they're displayed
    setTimeout(() => {
        canisters.forEach(([canisterId]) => {
            fetchCanisterMetrics(canisterId.toString());
        });
    }, 100);
}

async function registerCanister() {
    console.group('📝 Canister Registration');
    const canisterId = document.getElementById("canister-id").value.trim();
    const name = document.getElementById("canister-name").value.trim();
    const description = document.getElementById("canister-description").value.trim();

    console.log('Form Data:', {
        canisterId,
        name,
        description
    });

    try {
        // Validate canister ID format
        console.log('🔍 Validating canister ID format...');
        if (!canisterId.match(/^[a-z0-9-]+$/)) {
            console.error('❌ Invalid canister ID format');
            alert("Invalid canister ID format. Please enter a valid canister ID.");
            console.groupEnd();
            return;
        }
        console.log('✅ Canister ID format is valid');

        // Create a Principal from the canister ID string
        console.log('🔄 Converting canister ID to Principal...');
        const canisterPrincipal = Principal.fromText(canisterId);
        console.log('✅ Principal created:', canisterPrincipal.toString());

        console.log('🚀 Sending registration request to backend...');
        const result = await actor.registerCanister(canisterPrincipal, name, description);
        console.log('📬 Received response:', result);
        
        if ('ok' in result) {
            console.log('✅ Canister registered successfully!');
            alert("Canister registered successfully!");
            
            // Clear the form
            document.getElementById("register-canister-form").reset();
            console.log('🧹 Form cleared');
            
            // Refresh the list and fetch metrics with retry
            console.log('🔄 Refreshing canister list...');
            await loadUserCanisters();
            
            // Add a small delay before fetching metrics to ensure canister is registered
            console.log('⏳ Waiting to fetch initial metrics...');
            setTimeout(async () => {
                try {
                    console.log('📊 Fetching initial metrics...');
                    await fetchCanisterMetrics(canisterId);
                    console.log('✅ Initial metrics fetched');
                } catch (error) {
                    console.error('❌ Error fetching initial metrics:', error);
                }
            }, 1000);
        } else if (result.err && 'ControllerNotAdded' in result.err) {
            console.log('⚠️ Controller not added, showing instructions...');
            // Show controller addition instructions
            // Use production controller ID
            const platformController = "42xyq-zqaaa-aaaag-at2sq-cai";
            console.log('🔑 Platform Controller ID:', platformController);
            
            // For mainnet, include --network ic
            const command = `dfx canister --network ic update-settings ${canisterId} --add-controller ${platformController}`;
            console.log('📋 Generated command:', command);
            
            const statusDiv = document.createElement('div');
            statusDiv.className = 'alert alert-warning';
            statusDiv.innerHTML = `
                <h4>Controller Access Required</h4>
                <p>To monitor your canister, you need to add our platform as a controller. Run this command in your terminal:</p>
                <div class="code-block">
                    <code>${command}</code>
                    <button onclick="navigator.clipboard.writeText('${command}')">Copy Command</button>
                </div>
                <button onclick="retryRegistration('${canisterId}', '${name}', '${description}')">Verify and Continue</button>
            `;
            
            const container = document.getElementById("registration-status");
            container.innerHTML = '';
            container.appendChild(statusDiv);
            return;
        } else {
            alert("Failed to register canister: " + JSON.stringify(result.err));
        }
    } catch (error) {
        console.error('❌ Error registering canister:', error);
        if (error.message.includes("Invalid principal")) {
            console.error('❌ Invalid principal format');
            alert("Invalid canister ID format. Please check the ID and try again.");
        } else {
            console.error('❌ Unexpected error:', error.message);
            alert("Error registering canister: " + error.message);
        }
    }
    console.groupEnd();
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
    if (window.ruleCheckInterval) {
        clearInterval(window.ruleCheckInterval);
        window.ruleCheckInterval = null;
    }
    updateUI(false);
    // Force a page reload to ensure clean state
    window.location.reload();
}

function updateUI(isAuthenticated) {
    const authSection = document.getElementById("auth-section");
    const logoutSection = document.getElementById("logout-section");
    const userSection = document.getElementById("user-section");
    
    if (isAuthenticated) {
        authSection.style.display = "none";
        logoutSection.style.display = "block";
        userSection.style.display = "block";
    } else {
        authSection.style.display = "block";
        logoutSection.style.display = "none";
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
            // Store metrics in history
            if (!metricsHistory[canisterId]) {
                metricsHistory[canisterId] = [];
            }
            metricsHistory[canisterId].push({
                timestamp: Date.now(),
                ...result.ok
            });

            // Keep only last 30 days of data
            const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
            metricsHistory[canisterId] = metricsHistory[canisterId].filter(m => m.timestamp > thirtyDaysAgo);

            displayMetrics(canisterId, result.ok);
            updateCharts(canisterId);
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

let cyclesChart, cycleBurnRateChart, memoryChart, computeChart, freezingChart;
let metricsHistory = {};
let moduleUpdates = {};

function calculateCycleBurnRate(metrics) {
    if (metrics.length < 2) return 0;
    const latest = metrics[metrics.length - 1];
    const previous = metrics[metrics.length - 2];
    const timeDiff = (latest.timestamp - previous.timestamp) / (1000 * 60 * 60); // Convert to hours
    const cyclesDiff = Number(previous.cycles) - Number(latest.cycles);
    return cyclesDiff / timeDiff; // Cycles per hour
}

function createCharts(canisterId) {
    const ctx = {
        cycles: document.getElementById('cyclesChart').getContext('2d'),
        cycleBurnRate: document.getElementById('cycleBurnRateChart').getContext('2d'),
        memory: document.getElementById('memoryChart').getContext('2d'),
        compute: document.getElementById('computeChart').getContext('2d'),
        freezing: document.getElementById('freezingChart').getContext('2d')
    };

    cyclesChart = new Chart(ctx.cycles, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Cycles Balance',
                data: [],
                borderColor: 'rgb(75, 192, 192)',
                tension: 0.1
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Cycles'
                    }
                }
            }
        }
    });

    cycleBurnRateChart = new Chart(ctx.cycleBurnRate, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Cycle Burn Rate (per hour)',
                data: [],
                borderColor: 'rgb(255, 159, 64)',
                tension: 0.1
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: {
                    title: {
                        display: true,
                        text: 'Cycles/Hour'
                    }
                }
            }
        }
    });

    memoryChart = new Chart(ctx.memory, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Memory Usage',
                data: [],
                borderColor: 'rgb(255, 99, 132)',
                tension: 0.1
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Memory (Bytes)'
                    }
                }
            }
        }
    });

    computeChart = new Chart(ctx.compute, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Compute Allocation',
                data: [],
                borderColor: 'rgb(54, 162, 235)',
                tension: 0.1
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Compute Units'
                    }
                }
            }
        }
    });

    freezingChart = new Chart(ctx.freezing, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Freezing Threshold',
                data: [],
                borderColor: 'rgb(153, 102, 255)',
                tension: 0.1
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Threshold'
                    }
                }
            }
        }
    });
}

function updateCharts(canisterId) {
    if (!metricsHistory[canisterId]) return;

    const timeRange = document.getElementById('timeRange').value;
    const now = Date.now();
    let filterTime;

    switch (timeRange) {
        case '24h':
            filterTime = now - (24 * 60 * 60 * 1000);
            break;
        case '7d':
            filterTime = now - (7 * 24 * 60 * 60 * 1000);
            break;
        case '30d':
            filterTime = now - (30 * 24 * 60 * 60 * 1000);
            break;
        default:
            filterTime = 0;
    }

    const filteredMetrics = metricsHistory[canisterId].filter(m => m.timestamp > filterTime);
    const labels = filteredMetrics.map(m => new Date(m.timestamp).toLocaleString());

    cyclesChart.data.labels = labels;
    cyclesChart.data.datasets[0].data = filteredMetrics.map(m => Number(m.cycles));
    cyclesChart.update();

    const burnRates = [];
    for (let i = 1; i < filteredMetrics.length; i++) {
        const timeDiff = (filteredMetrics[i].timestamp - filteredMetrics[i-1].timestamp) / (1000 * 60 * 60);
        const cyclesDiff = Number(filteredMetrics[i-1].cycles) - Number(filteredMetrics[i].cycles);
        burnRates.push(cyclesDiff / timeDiff);
    }
    cycleBurnRateChart.data.labels = labels.slice(1);
    cycleBurnRateChart.data.datasets[0].data = burnRates;
    cycleBurnRateChart.update();

    memoryChart.data.labels = labels;
    memoryChart.data.datasets[0].data = filteredMetrics.map(m => Number(m.memorySize));
    memoryChart.update();

    computeChart.data.labels = labels;
    computeChart.data.datasets[0].data = filteredMetrics.map(m => Number(m.computeAllocation || 0));
    computeChart.update();

    freezingChart.data.labels = labels;
    freezingChart.data.datasets[0].data = filteredMetrics.map(m => Number(m.freezingThreshold || 0));
    freezingChart.update();
}

function displayMetrics(canisterId, metrics) {
    const metricsContainer = document.getElementById(`metrics-${canisterId}`);
    if (!metricsContainer) return;

    document.getElementById('metrics-section').style.display = 'block';
    
    // Destroy existing charts before creating new ones
    if (cyclesChart) cyclesChart.destroy();
    if (cycleBurnRateChart) cycleBurnRateChart.destroy();
    if (memoryChart) memoryChart.destroy();
    if (computeChart) computeChart.destroy();
    if (freezingChart) freezingChart.destroy();
    
    createCharts(canisterId);

    // Check for module hash changes
    if (!moduleUpdates[canisterId]) {
        moduleUpdates[canisterId] = [];
    }
    
    const currentHash = metrics.moduleHash ? Array.from(metrics.moduleHash).map(b => b.toString(16).padStart(2, '0')).join('') : null;
    const lastUpdate = moduleUpdates[canisterId][moduleUpdates[canisterId].length - 1];
    
    if (currentHash && (!lastUpdate || lastUpdate.hash !== currentHash)) {
        moduleUpdates[canisterId].push({
            timestamp: Date.now(),
            hash: currentHash
        });
    }

    // Update module updates timeline
    const timelineContainer = document.getElementById('moduleUpdatesTimeline');
    timelineContainer.innerHTML = moduleUpdates[canisterId]
        .sort((a, b) => b.timestamp - a.timestamp)
        .map(update => `
            <div class="update-entry">
                <span class="update-time">${new Date(update.timestamp).toLocaleString()}</span>
                <span class="update-hash">${update.hash}</span>
            </div>
        `).join('');

    const normalizedMetrics = {
        timestamp: Date.now(),
        cycles: Number(metrics.cycles),
        memorySize: Number(metrics.memorySize),
        computeAllocation: Number(metrics.computeAllocation || 0),
        freezingThreshold: Number(metrics.freezingThreshold || 0),
        ...metrics
    };

    // Update metrics history
    if (!metricsHistory[canisterId]) {
        metricsHistory[canisterId] = [];
    }
    metricsHistory[canisterId].push(normalizedMetrics);

    // Keep only last 30 days of data
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    metricsHistory[canisterId] = metricsHistory[canisterId].filter(m => m.timestamp > thirtyDaysAgo);

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
            ${Number(metrics.computeAllocation || 0)}%
        </div>
        <div class="metric-item">
            <span class="metric-label">Freezing Threshold:</span>
            ${formatNumber(metrics.freezingThreshold || 0)} seconds
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

// Make functions available globally
window.depositICP = async function depositICP() {
    const amount = document.getElementById("deposit-amount").value;
    console.log("Attempting to deposit:", amount, "ICP");
    
    if (!amount || amount <= 0) {
        alert("Please enter a valid amount");
        return;
    }

    try {
        // Convert amount to BigInt e8s
        const amountE8s = BigInt(Math.floor(amount * 100000000));
        const result = await actor.depositICP(amountE8s);
        
        if ('ok' in result) {
            console.log("Deposit successful");
            document.getElementById("deposit-amount").value = "";
            await loadICPBalance();
            alert("ICP deposited successfully!");
        } else if ('err' in result) {
            console.error("Deposit failed with error:", result.err);
            alert("Failed to deposit ICP: " + JSON.stringify(result.err));
        }
    } catch (error) {
        console.error("Error during deposit:", error);
        // Only show error if it's not related to response parsing
        if (!error.message.includes("JSON") && !error.message.includes("parse")) {
            alert("Error depositing ICP: " + error.message);
        } else {
            console.log("Deposit may have succeeded, refreshing balance...");
            await loadICPBalance();
        }
    }
}

// Retry registration after controller is added
async function retryRegistration(canisterId, name, description) {
    console.group('🔄 Retry Registration');
    console.log('Parameters:', { canisterId, name, description });

    try {
        console.log('🔄 Converting canister ID to Principal...');
        const canisterPrincipal = Principal.fromText(canisterId);
        console.log('✅ Principal created:', canisterPrincipal.toString());

        console.log('🚀 Sending retry registration request...');
        const result = await actor.registerCanister(canisterPrincipal, name, description);
        console.log('📬 Received response:', result);
        
        if ('ok' in result) {
            console.log('✅ Canister registered successfully!');
            alert("Canister registered successfully!");
            document.getElementById("registration-status").innerHTML = '';
            console.log('🔄 Refreshing canister list...');
            await loadUserCanisters();
            
            console.log('⏳ Waiting to fetch initial metrics...');
            setTimeout(async () => {
                try {
                    console.log('📊 Fetching initial metrics...');
                    await fetchCanisterMetrics(canisterId);
                    console.log('✅ Initial metrics fetched');
                } catch (error) {
                    console.error('❌ Error fetching initial metrics:', error);
                }
            }, 1000);
        } else if (result.err && 'ControllerNotAdded' in result.err) {
            console.warn('⚠️ Controller still not added');
            alert("Platform controller not yet added. Please run the command and try again.");
        } else {
            console.error('❌ Registration failed:', result.err);
            alert("Failed to register canister: " + JSON.stringify(result.err));
        }
    } catch (error) {
        console.error('❌ Error in retry registration:', error);
        alert("Error retrying registration: " + error.message);
    }
    console.groupEnd();
}

// Make functions available globally
window.retryRegistration = retryRegistration;
window.toggleRule = toggleRule;
window.deleteRule = deleteRule;
window.refreshMetrics = fetchCanisterMetrics;
window.registerCanister = registerCanister;

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

// Rule Management Functions
async function loadRules() {
    try {
        const result = await actor.listRules();
        if (result.ok) {
            displayRules(result.ok);
        } else {
            console.error("Failed to load rules:", result.err);
        }
    } catch (error) {
        console.error("Error loading rules:", error);
    }
}

function displayRules(rules) {
    console.log("Displaying rules:", rules);
    const container = document.getElementById("rules-container");
    container.innerHTML = "";

    if (rules.length === 0) {
        container.innerHTML = "<p>No rules created yet.</p>";
        return;
    }

    rules.forEach(rule => {
        console.log("Processing rule:", rule);
        const card = document.createElement("div");
        card.className = "rule-card";
        
        // Format condition
        let conditionText = "";
        if ('CyclesBelow' in rule.condition) {
            conditionText = `Cycles below ${formatNumber(rule.condition.CyclesBelow)}`;
        } else if ('MemoryUsageAbove' in rule.condition) {
            conditionText = `Memory usage above ${formatBytes(rule.condition.MemoryUsageAbove)}`;
        } else if ('ComputeAllocationAbove' in rule.condition) {
            conditionText = `Compute allocation above ${rule.condition.ComputeAllocationAbove}%`;
        }

        // Format action
        let actionText = "";
        if ('TopUpCycles' in rule.action) {
            actionText = `Top up with ${formatNumber(rule.action.TopUpCycles)} cycles`;
        } else if ('NotifyOwner' in rule.action) {
            actionText = `Send notification: ${rule.action.NotifyOwner}`;
        } else if ('AdjustComputeAllocation' in rule.action) {
            actionText = `Adjust compute allocation to ${rule.action.AdjustComputeAllocation}%`;
        }

        const lastTriggered = rule.lastTriggered ? 
            new Date(Number(rule.lastTriggered) / 1000000).toLocaleString() : 
            "Never";

        card.innerHTML = `
            <div class="rule-header">
                <h5>Rule for ${rule.canisterId.toString()}</h5>
                <div class="rule-status ${rule.enabled ? 'enabled' : 'disabled'}">
                    ${rule.enabled ? 'Enabled' : 'Disabled'}
                </div>
            </div>
            <p><strong>Condition:</strong> ${conditionText}</p>
            <p><strong>Action:</strong> ${actionText}</p>
            <p><strong>Cooldown:</strong> ${Number(rule.cooldownPeriod) / (60 * 60 * 1000000000)} hours</p>
            <p><strong>Last Triggered:</strong> ${lastTriggered}</p>
            <div class="rule-actions">
                <button onclick="toggleRule('${rule.id}', ${!rule.enabled})" class="secondary">
                    ${rule.enabled ? 'Disable' : 'Enable'}
                </button>
                <button onclick="deleteRule('${rule.id}')" class="danger">Delete</button>
            </div>
        `;
        
        container.appendChild(card);
    });
}

async function createRule(event) {
    event.preventDefault();

    const canisterId = document.getElementById("rule-canister").value;
    const conditionType = document.getElementById("rule-condition-type").value;
    const conditionValue = document.getElementById("rule-condition-value").value;
    const actionType = document.getElementById("rule-action-type").value;
    const actionValue = document.getElementById("rule-action-value").value;
    const cooldownHours = document.getElementById("rule-cooldown").value;

    try {
        let condition;
        switch (conditionType) {
            case "cycles":
                condition = { CyclesBelow: BigInt(conditionValue) };
                break;
            case "memory":
                condition = { MemoryUsageAbove: BigInt(conditionValue) };
                break;
            case "compute":
                condition = { ComputeAllocationAbove: Number(conditionValue) };
                break;
        }

        let action;
        switch (actionType) {
            case "topup":
                action = { TopUpCycles: BigInt(actionValue) };
                break;
            case "notify":
                action = { NotifyOwner: actionValue.toString() };
                break;
            case "compute":
                action = { AdjustComputeAllocation: Number(actionValue) };
                break;
        }

        const cooldownNanos = BigInt(cooldownHours) * BigInt(3600000000000); // Convert hours to nanoseconds
        console.log("Creating rule with:", {
            canisterId,
            condition,
            action,
            cooldownNanos
        });

        const result = await actor.createRule(
            Principal.fromText(canisterId),
            condition,
            action,
            cooldownNanos
        );

        console.log("Create rule result:", result);

        if (result.ok) {
            alert("Rule created successfully!");
            document.getElementById("create-rule-form").reset();
            await loadRules();
        } else {
            alert("Failed to create rule: " + JSON.stringify(result.err));
        }
    } catch (error) {
        console.error("Error creating rule:", error);
        alert("Error creating rule: " + error.message);
    }
}

async function toggleRule(ruleId, enabled) {
    console.log("Toggling rule:", ruleId, "to enabled:", enabled);
    try {
        // Pass only the enabled parameter, keeping others as null
        const result = await actor.updateRule(
            ruleId,        // ruleId
            null,          // condition (no change)
            null,          // action (no change)
            [enabled],     // enabled (wrapped in array to make it optional)
            null           // cooldownPeriod (no change)
        );
        console.log("Toggle result:", result);
        
        if (result.ok) {
            await loadRules();
        } else {
            alert("Failed to update rule: " + JSON.stringify(result.err));
        }
    } catch (error) {
        console.error("Error updating rule:", error);
        alert("Error updating rule: " + error.message);
    }
}

async function deleteRule(ruleId) {
    if (!confirm("Are you sure you want to delete this rule?")) {
        return;
    }

    try {
        const result = await actor.deleteRule(ruleId);
        // The backend returns {ok: null} on success
        if ('ok' in result) {
            await loadRules();
        } else if ('err' in result) {
            alert("Failed to delete rule: " + JSON.stringify(result.err));
        }
    } catch (error) {
        console.error("Error deleting rule:", error);
        alert("Error deleting rule: " + error.message);
    }
}

// ICP Balance Management
async function loadICPBalance() {
    try {
        const result = await actor.getICPBalance();
        if (result.ok) {
            // Convert from e8s back to ICP for display
            const icpAmount = Number(result.ok) / 100000000;
            document.getElementById("icpBalance").textContent = icpAmount.toFixed(8);
        } else {
            console.error("Failed to load ICP balance:", result.err);
        }
    } catch (error) {
        console.error("Error loading ICP balance:", error);
    }
}

// Add event listeners
document.getElementById("create-rule-form").onsubmit = createRule;

// Add periodic rule checking
function startPeriodicRuleCheck() {
    const ONE_HOUR = 60 * 60 * 1000; // 1 hour in milliseconds
    
    async function checkRules() {
        try {
            if (!actor) {
                console.warn("Actor not initialized yet");
                return;
            }

            const result = await actor.checkAndExecuteRules();
            if (result.err) {
                console.error("Error checking rules:", result.err);
            }
            
            // Refresh rules display
            await loadRules();
            await loadICPBalance();
        } catch (error) {
            console.error("Error in rule check:", error);
        }
    }
    
    // Clear any existing interval
    if (window.ruleCheckInterval) {
        clearInterval(window.ruleCheckInterval);
    }
    
    // Set up periodic checks
    window.ruleCheckInterval = setInterval(checkRules, ONE_HOUR);
    
    // Run initial check
    checkRules();
}

init();
