import Principal "mo:base/Principal";
import HashMap "mo:base/HashMap";
import Error "mo:base/Error";
import Result "mo:base/Result";
import Text "mo:base/Text";
import Option "mo:base/Option";
import Iter "mo:base/Iter";
import Time "mo:base/Time";
import Nat "mo:base/Nat";
import Int "mo:base/Int";
import Debug "mo:base/Debug";

actor {
    // Platform configuration
    let PLATFORM_CONTROLLER_ID : Principal = Principal.fromText("42xyq-zqaaa-aaaag-at2sq-cai"); // Production/IC network backend canister ID

    // Types
    type UserId = Principal;
    type AuthError = {
        #NotAuthenticated;
        #AlreadyExists;
        #NotFound;
        #ControllerNotAdded;
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

    // Rule-based action types
    type RuleCondition = {
        #CyclesBelow: Nat;  // Trigger when cycles fall below this amount
        #MemoryUsageAbove: Nat;  // Trigger when memory usage exceeds this amount
        #ComputeAllocationAbove: Nat;  // Trigger when compute allocation exceeds this percentage
    };

    type RuleAction = {
        #TopUpCycles: Nat;  // Amount of cycles to top up
        #NotifyOwner: Text;  // Message to send to owner
        #AdjustComputeAllocation: Nat;  // New compute allocation to set
    };

    type Rule = {
        id: Text;  // Unique identifier for the rule
        canisterId: Principal;
        condition: RuleCondition;
        action: RuleAction;
        enabled: Bool;
        lastTriggered: ?Int;  // Timestamp of last trigger
        cooldownPeriod: Int;  // Minimum time (in nanoseconds) between triggers
        owner: Principal;
    };

    type RuleError = {
        #NotAuthorized;
        #RuleNotFound;
        #InvalidCondition;
        #InvalidAction;
        #InsufficientBalance;
    };

    // State
    private stable var registeredUsers : [(Principal, Text)] = [];
    private var users = HashMap.HashMap<Principal, Text>(10, Principal.equal, Principal.hash);

    private stable var registeredCanisters : [(CanisterId, CanisterInfo)] = [];
    private var canisters = HashMap.HashMap<CanisterId, CanisterInfo>(10, Principal.equal, Principal.hash);

    // Additional state for monitoring
    private stable var canisterMetrics : [(CanisterId, CanisterMetrics)] = [];
    private var metrics = HashMap.HashMap<CanisterId, CanisterMetrics>(10, Principal.equal, Principal.hash);

    // Rule-based action state
    private stable var userRules : [(Text, Rule)] = [];
    private var rules = HashMap.HashMap<Text, Rule>(10, Text.equal, Text.hash);

    // User ICP balances for automatic top-ups
    private stable var userBalances : [(Principal, Nat)] = [];
    private var balances = HashMap.HashMap<Principal, Nat>(10, Principal.equal, Principal.hash);

    // Initialize state
    system func preupgrade() {
        registeredUsers := Iter.toArray(users.entries());
        registeredCanisters := Iter.toArray(canisters.entries());
        canisterMetrics := Iter.toArray(metrics.entries());
        userRules := Iter.toArray(rules.entries());
        userBalances := Iter.toArray(balances.entries());
    };

    system func postupgrade() {
        users := HashMap.fromIter<Principal, Text>(registeredUsers.vals(), 10, Principal.equal, Principal.hash);
        canisters := HashMap.fromIter<CanisterId, CanisterInfo>(registeredCanisters.vals(), 10, Principal.equal, Principal.hash);
        metrics := HashMap.fromIter<CanisterId, CanisterMetrics>(canisterMetrics.vals(), 10, Principal.equal, Principal.hash);
        rules := HashMap.fromIter<Text, Rule>(userRules.vals(), 10, Text.equal, Text.hash);
        balances := HashMap.fromIter<Principal, Nat>(userBalances.vals(), 10, Principal.equal, Principal.hash);
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

    // IC Management Canister interface for controller verification
    private func isControllerAdded(canisterId: Principal) : async Bool {
        Debug.print("Checking controllers for canister: " # Principal.toText(canisterId));
        try {
            let status = await management_canister.canister_status({
                canister_id = canisterId;
            });
            
            Debug.print("Current controllers:");
            for (controller in status.settings.controllers.vals()) {
                Debug.print("  - " # Principal.toText(controller));
                if (controller == PLATFORM_CONTROLLER_ID) {
                    Debug.print("✅ Platform controller found!");
                    return true;
                };
            };
            Debug.print("❌ Platform controller not found");
            false;
        } catch (e) {
            Debug.print("❌ Error checking controllers: " # Error.message(e));
            false;
        };
    };

    // Canister Management Methods
    public shared(msg) func registerCanister(canisterId: Principal, name: Text, description: Text) : async Result.Result<(), AuthError> {
        let caller = msg.caller;
        Debug.print("📝 Registering canister:");
        Debug.print("  - Canister ID: " # Principal.toText(canisterId));
        Debug.print("  - Name: " # name);
        Debug.print("  - Description: " # description);
        Debug.print("  - Caller: " # Principal.toText(caller));
        
        if (Principal.isAnonymous(caller)) {
            Debug.print("❌ Anonymous caller rejected");
            return #err(#NotAuthenticated);
        };

        // Verify if platform controller is added
        Debug.print("🔍 Checking platform controller...");
        let hasController = await isControllerAdded(canisterId);
        if (not hasController) {
            Debug.print("❌ Platform controller not found");
            return #err(#ControllerNotAdded);
        };
        Debug.print("✅ Platform controller verified");

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

    // Rule management methods
    public shared(msg) func createRule(
        canisterId: Principal,
        condition: RuleCondition,
        action: RuleAction,
        cooldownPeriod: Int
    ) : async Result.Result<Text, RuleError> {
        let caller = msg.caller;
        
        if (Principal.isAnonymous(caller)) {
            return #err(#NotAuthorized);
        };

        // Verify canister ownership
        switch (canisters.get(canisterId)) {
            case (?info) {
                if (not Principal.equal(info.owner, caller)) {
                    return #err(#NotAuthorized);
                };
            };
            case null {
                return #err(#NotAuthorized);
            };
        };

        // Generate unique rule ID
        let ruleId = Principal.toText(caller) # "-" # Int.toText(Time.now());

        let newRule : Rule = {
            id = ruleId;
            canisterId = canisterId;
            condition = condition;
            action = action;
            enabled = true;
            lastTriggered = ?Time.now();  // Initialize with current time
            cooldownPeriod = cooldownPeriod;
            owner = caller;
        };

        rules.put(ruleId, newRule);
        #ok(ruleId)
    };

    public shared(msg) func updateRule(
        ruleId: Text,
        condition: ?RuleCondition,
        action: ?RuleAction,
        enabled: ?Bool,
        cooldownPeriod: ?Int
    ) : async Result.Result<(), RuleError> {
        let caller = msg.caller;
        
        switch (rules.get(ruleId)) {
            case (?rule) {
                if (not Principal.equal(rule.owner, caller)) {
                    return #err(#NotAuthorized);
                };

                let updatedRule : Rule = {
                    id = rule.id;
                    canisterId = rule.canisterId;
                    condition = Option.get(condition, rule.condition);
                    action = Option.get(action, rule.action);
                    enabled = Option.get(enabled, rule.enabled);
                    lastTriggered = rule.lastTriggered;
                    cooldownPeriod = Option.get(cooldownPeriod, rule.cooldownPeriod);
                    owner = rule.owner;
                };

                rules.put(ruleId, updatedRule);
                #ok(())
            };
            case null {
                #err(#RuleNotFound)
            };
        }
    };

    public shared(msg) func deleteRule(ruleId: Text) : async Result.Result<(), RuleError> {
        let caller = msg.caller;
        
        switch (rules.get(ruleId)) {
            case (?rule) {
                if (not Principal.equal(rule.owner, caller)) {
                    return #err(#NotAuthorized);
                };

                rules.delete(ruleId);
                #ok(())
            };
            case null {
                #err(#RuleNotFound)
            };
        }
    };

    public shared query(msg) func listRules() : async Result.Result<[Rule], RuleError> {
        let caller = msg.caller;
        
        if (Principal.isAnonymous(caller)) {
            return #err(#NotAuthorized);
        };

        let userRulesList = Iter.toArray(
            Iter.filter(
                rules.vals(),
                func(rule: Rule): Bool {
                    Principal.equal(rule.owner, caller)
                }
            )
        );

        #ok(userRulesList)
    };

    // ICP balance management
    public shared(msg) func depositICP(amount: Nat) : async Result.Result<(), RuleError> {
        let caller = msg.caller;
        
        if (Principal.isAnonymous(caller)) {
            return #err(#NotAuthorized);
        };

        let currentBalance = Option.get(balances.get(caller), 0);
        balances.put(caller, currentBalance + amount);
        #ok(())
    };

    public shared query(msg) func getICPBalance() : async Result.Result<Nat, RuleError> {
        let caller = msg.caller;
        
        if (Principal.isAnonymous(caller)) {
            return #err(#NotAuthorized);
        };

        #ok(Option.get(balances.get(caller), 0))
    };

    // Rule evaluation and execution
    private func evaluateRule(rule: Rule, metrics: CanisterMetrics) : Bool {
        if (not rule.enabled) {
            return false;
        };

        // Check cooldown period
        switch (rule.lastTriggered) {
            case (?lastTrigger) {
                if (Time.now() - lastTrigger < rule.cooldownPeriod) {
                    return false;
                };
            };
            case null {};
        };

        // Evaluate condition
        switch (rule.condition) {
            case (#CyclesBelow(threshold)) {
                metrics.cycles < threshold
            };
            case (#MemoryUsageAbove(threshold)) {
                metrics.memorySize > threshold
            };
            case (#ComputeAllocationAbove(threshold)) {
                metrics.computeAllocation > threshold
            };
        }
    };

    // This method should be called periodically to check and execute rules
    public shared(msg) func checkAndExecuteRules() : async Result.Result<(), RuleError> {
        let caller = msg.caller;
        
        if (Principal.isAnonymous(caller)) {
            return #err(#NotAuthorized);
        };

        for ((_, rule) in rules.entries()) {
            if (Principal.equal(rule.owner, caller)) {
                switch (metrics.get(rule.canisterId)) {
                    case (?canisterMetrics) {
                        if (evaluateRule(rule, canisterMetrics)) {
                            // Execute action based on rule type
                            switch (rule.action) {
                                case (#TopUpCycles(amount)) {
                                    // Here you would implement the actual top-up logic
                                    // This would involve converting ICP to cycles and transferring them
                                    // For now, we'll just update the last triggered time
                                    let updatedRule = {
                                        rule with
                                        lastTriggered = ?Time.now()
                                    };
                                    rules.put(rule.id, updatedRule);
                                };
                                case (#NotifyOwner(_)) {
                                    // Implement notification logic here
                                    let updatedRule = {
                                        rule with
                                        lastTriggered = ?Time.now()
                                    };
                                    rules.put(rule.id, updatedRule);
                                };
                                case (#AdjustComputeAllocation(newAllocation)) {
                                    // Implement compute allocation adjustment logic here
                                    let updatedRule = {
                                        rule with
                                        lastTriggered = ?Time.now()
                                    };
                                    rules.put(rule.id, updatedRule);
                                };
                            };
                        };
                    };
                    case null {};
                };
            };
        };
        #ok(())
    };
};
