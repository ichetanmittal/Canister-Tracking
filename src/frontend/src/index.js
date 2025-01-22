import { AuthClient } from "@dfinity/auth-client";
import { Actor, HttpAgent } from "@dfinity/agent";
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

    // Create actor with the canister ID and interface factory
    actor = Actor.createActor(idlFactory, {
        agent,
        canisterId: canisterId,
    });

    // Get the user's principal ID
    const principal = identity.getPrincipal().toString();
    document.getElementById("principalId").textContent = principal;

    // Try to register the user if not already registered
    try {
        const result = await actor.registerUser(principal);
        if (result.err) {
            if (result.err !== "AlreadyExists") {
                console.error("Failed to register user:", result.err);
            }
        }
    } catch (e) {
        console.error("Error registering user:", e);
    }

    updateUI(true);
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
