import Principal "mo:base/Principal";
import HashMap "mo:base/HashMap";
import Error "mo:base/Error";
import Result "mo:base/Result";
import Text "mo:base/Text";
import Option "mo:base/Option";
import Iter "mo:base/Iter";
import Time "mo:base/Time";
import Nat "mo:base/Nat";

actor {
    // Types
    type UserId = Principal;
    type AuthError = {
        #NotAuthenticated;
        #AlreadyExists;
        #NotFound;
    };

    // Canister Types
    type CanisterId = Principal;
    type CanisterInfo = {
        name: Text;
        description: Text;
        owner: Principal;
        createdAt: Int;
    };

    // IC Management Canister interface
    type Status = {
        #running;
        #stopping;
        #stopped;
    };

    type DefiniteCanisterSettings = {
        controllers : [Principal];
        compute_allocation : Nat;
        memory_allocation : Nat;
        freezing_threshold : Nat;
    };

    type CanisterStatus = {
        status : Status;
        settings : DefiniteCanisterSettings;
        module_hash : ?[Nat8];
        memory_size : Nat;
        cycles : Nat;
    };

    let management_canister : actor {
        canister_status : { canister_id : Principal } -> async CanisterStatus;
    } = actor "aaaaa-aa";

    // New types for monitoring
    type CanisterMetrics = {
        memorySize: Nat;  // Memory usage
        cycles: Nat;      // Available cycles
        moduleHash: ?[Nat8];  // Module hash
        controllers: [Principal];  // Controllers
        status: Text;     // Canister status
        computeAllocation: Nat;  // Compute allocation
        freezingThreshold: Nat;  // Freezing threshold
        createdAt: Int;   // Creation timestamp
        subnetId: ?Principal;  // Subnet information
        storageUtilization: Nat;  // Storage utilization
        lastUpdated: Int;  // Last time metrics were updated
    };

    type MonitoringError = {
        #CanisterNotFound;
        #UpdateFailed;
        #NotAuthorized;
    };

    // State
    private stable var registeredUsers : [(Principal, Text)] = [];
    private var users = HashMap.HashMap<Principal, Text>(10, Principal.equal, Principal.hash);

    private stable var registeredCanisters : [(CanisterId, CanisterInfo)] = [];
    private var canisters = HashMap.HashMap<CanisterId, CanisterInfo>(10, Principal.equal, Principal.hash);

    // Additional state for monitoring
    private stable var canisterMetrics : [(CanisterId, CanisterMetrics)] = [];
    private var metrics = HashMap.HashMap<CanisterId, CanisterMetrics>(10, Principal.equal, Principal.hash);

    // Initialize state
    system func preupgrade() {
        registeredUsers := Iter.toArray(users.entries());
        registeredCanisters := Iter.toArray(canisters.entries());
        canisterMetrics := Iter.toArray(metrics.entries());
    };

    system func postupgrade() {
        users := HashMap.fromIter<Principal, Text>(registeredUsers.vals(), 10, Principal.equal, Principal.hash);
        canisters := HashMap.fromIter<CanisterId, CanisterInfo>(registeredCanisters.vals(), 10, Principal.equal, Principal.hash);
        metrics := HashMap.fromIter<CanisterId, CanisterMetrics>(canisterMetrics.vals(), 10, Principal.equal, Principal.hash);
    };

    // Authentication methods
    public shared(msg) func registerUser(username : Text) : async Result.Result<(), AuthError> {
        let caller = msg.caller;
        
        if (Principal.isAnonymous(caller)) {
            return #err(#NotAuthenticated);
        };

        switch (users.get(caller)) {
            case (?existing) {
                #err(#AlreadyExists)
            };
            case null {
                users.put(caller, username);
                #ok(())
            };
        }
    };

    public shared query(msg) func getUsername() : async Result.Result<Text, AuthError> {
        let caller = msg.caller;
        
        if (Principal.isAnonymous(caller)) {
            return #err(#NotAuthenticated);
        };

        switch (users.get(caller)) {
            case (?username) {
                #ok(username)
            };
            case null {
                #err(#NotFound)
            };
        }
    };

    public shared query(msg) func isAuthenticated() : async Bool {
        not Principal.isAnonymous(msg.caller)
    };

    public shared query(msg) func whoami() : async Principal {
        msg.caller
    };

    public query func greet(name : Text) : async Text {
        return "Hello, " # name # "!";
    };

    // Canister Management Methods
    public shared(msg) func registerCanister(canisterId: Principal, name: Text, description: Text) : async Result.Result<(), AuthError> {
        let caller = msg.caller;
        
        if (Principal.isAnonymous(caller)) {
            return #err(#NotAuthenticated);
        };

        let canisterInfo : CanisterInfo = {
            name = name;
            description = description;
            owner = caller;
            createdAt = Time.now();
        };

        canisters.put(canisterId, canisterInfo);
        #ok(())
    };

    public shared query(msg) func getCanisterInfo(canisterId: Principal) : async Result.Result<CanisterInfo, AuthError> {
        let caller = msg.caller;
        
        if (Principal.isAnonymous(caller)) {
            return #err(#NotAuthenticated);
        };

        switch (canisters.get(canisterId)) {
            case (?info) {
                #ok(info)
            };
            case null {
                #err(#NotFound)
            };
        }
    };

    public shared query(msg) func listUserCanisters() : async Result.Result<[(CanisterId, CanisterInfo)], AuthError> {
        let caller = msg.caller;
        
        if (Principal.isAnonymous(caller)) {
            return #err(#NotAuthenticated);
        };

        let userCanisters = Iter.toArray(
            Iter.filter(
                canisters.entries(), 
                func((_, info): (CanisterId, CanisterInfo)): Bool {
                    Principal.equal(info.owner, caller)
                }
            )
        );

        #ok(userCanisters)
    };

    public shared(msg) func updateCanisterInfo(canisterId: Principal, name: Text, description: Text) : async Result.Result<(), AuthError> {
        let caller = msg.caller;
        
        if (Principal.isAnonymous(caller)) {
            return #err(#NotAuthenticated);
        };

        switch (canisters.get(canisterId)) {
            case (?info) {
                if (not Principal.equal(info.owner, caller)) {
                    return #err(#NotAuthenticated);
                };

                let updatedInfo : CanisterInfo = {
                    name = name;
                    description = description;
                    owner = caller;
                    createdAt = info.createdAt;
                };

                canisters.put(canisterId, updatedInfo);
                #ok(())
            };
            case null {
                #err(#NotFound)
            };
        }
    };

    // Update monitoring methods
    public shared(msg) func updateCanisterMetrics(canisterId: Principal) : async Result.Result<(), MonitoringError> {
        let caller = msg.caller;
        
        if (Principal.isAnonymous(caller)) {
            return #err(#NotAuthorized);
        };

        switch (canisters.get(canisterId)) {
            case (?info) {
                if (not Principal.equal(info.owner, caller)) {
                    return #err(#NotAuthorized);
                };
                
                try {
                    let status = await management_canister.canister_status({ canister_id = canisterId });
                    
                    let metricData : CanisterMetrics = {
                        memorySize = status.memory_size;
                        cycles = status.cycles;
                        moduleHash = status.module_hash;
                        controllers = status.settings.controllers;
                        status = switch (status.status) {
                            case (#running) { "running" };
                            case (#stopping) { "stopping" };
                            case (#stopped) { "stopped" };
                        };
                        computeAllocation = status.settings.compute_allocation;
                        freezingThreshold = status.settings.freezing_threshold;
                        createdAt = info.createdAt;  // Use the creation time from CanisterInfo
                        subnetId = null;  // This will be updated when we get subnet info
                        storageUtilization = status.memory_size;  // For now, use memory size as storage utilization
                        lastUpdated = Time.now();
                    };

                    metrics.put(canisterId, metricData);
                    #ok(())
                } catch (e) {
                    #err(#UpdateFailed)
                };
            };
            case null {
                #err(#CanisterNotFound)
            };
        }
    };

    public shared query(msg) func getCanisterMetrics(canisterId: Principal) : async Result.Result<CanisterMetrics, MonitoringError> {
        let caller = msg.caller;
        
        if (Principal.isAnonymous(caller)) {
            return #err(#NotAuthorized);
        };

        switch (metrics.get(canisterId)) {
            case (?m) {
                #ok(m)
            };
            case null {
                #err(#CanisterNotFound)
            };
        }
    };

    public shared query(msg) func getAllCanisterMetrics() : async Result.Result<[(CanisterId, CanisterMetrics)], MonitoringError> {
        let caller = msg.caller;
        
        if (Principal.isAnonymous(caller)) {
            return #err(#NotAuthorized);
        };

        let userMetrics = Iter.toArray(
            Iter.filter(
                metrics.entries(),
                func((canisterId, _): (CanisterId, CanisterMetrics)): Bool {
                    switch (canisters.get(canisterId)) {
                        case (?info) { Principal.equal(info.owner, caller) };
                        case null { false };
                    }
                }
            )
        );

        #ok(userMetrics)
    };
};
