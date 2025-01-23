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
    container.innerHTML = ""; // Clear existing content

    if (canisters.length === 0) {
        container.innerHTML = "<p>No canisters registered yet.</p>";
        return;
    }

    canisters.forEach(([canisterId, info]) => {
        const card = document.createElement("div");
        card.className = "canister-card";
        
        const createdDate = new Date(Number(info.createdAt) / 1000000); // Convert nanoseconds to milliseconds
        
        // Properly escape values and use JSON.stringify for string values to handle special characters
        card.innerHTML = `
            <h5>${info.name}</h5>
            <p><strong>ID:</strong> ${canisterId.toString()}</p>
            <p><strong>Description:</strong> ${info.description}</p>
            <p><strong>Created:</strong> ${createdDate.toLocaleDateString()}</p>
            <button onclick='window.editCanister(${JSON.stringify(canisterId.toString())}, ${JSON.stringify(info.name)}, ${JSON.stringify(info.description)})'>Edit</button>
        `;
        
        container.appendChild(card);
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

init();
