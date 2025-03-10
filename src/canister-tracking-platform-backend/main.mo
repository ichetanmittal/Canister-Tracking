import Principal "mo:base/Principal";
import HashMap "mo:base/HashMap";
import Error "mo:base/Error";
import Result "mo:base/Result";
import Text "mo:base/Text";
import Option "mo:base/Option";
import Iter "mo:base/Iter";
import Time "mo:base/Time";
import Nat "mo:base/Nat";
import Nat64 "mo:base/Nat64";
import Int "mo:base/Int";
import Debug "mo:base/Debug";
import Cycles "mo:base/ExperimentalCycles";

actor {
    // Platform configuration
    // Production/IC network backend canister ID
    let PLATFORM_CONTROLLER_ID : Principal = Principal.fromText("42xyq-zqaaa-aaaag-at2sq-cai"); 
    
    // Local development backend canister ID (dfx deploy generated)
    // let PLATFORM_CONTROLLER_ID : Principal = Principal.fromText("bkyz2-fmaaa-aaaaa-qaaaq-cai");

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

    type IC = actor {
        deposit_cycles : { canister_id : Principal } -> async ();
    };

    let management_canister : actor {
        canister_status : { canister_id : Principal } -> async CanisterStatus;
        deposit_cycles : { canister_id : Principal } -> async ();
    } = actor("aaaaa-aa");

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

    // ICP Ledger interface
    let ICP_LEDGER_CANISTER_ID : Principal = Principal.fromText("ryjl3-tyaaa-aaaaa-aaaba-cai");

    type AccountIdentifier = Blob;
    type Tokens = {
        e8s : Nat64;
    };

    type Account = {
        owner : Principal;
        subaccount : ?[Nat8];
    };

    type AccountIdText = Text;

    // Constants for ICP/Cycles conversion
    let ICP_CYCLES_CONVERSION_RATE : Nat = 5_300_000_000_000; // 1 ICP = 5.3T cycles (current rate)
    let MIN_ICP_FOR_CONVERSION : Nat = 100_000; // Minimum ICP required for conversion (in e8s)

    // Extended ledger interface
    type TransferArgs = {
        memo: Nat64;
        amount: { e8s: Nat64 };
        fee: { e8s: Nat64 };
        from_subaccount: ?[Nat8];
        to: AccountIdentifier;
        created_at_time: ?{ timestamp_nanos: Nat64 };
    };

    let ledger : actor {
        icrc1_balance_of : shared query { owner : Principal; subaccount : ?[Nat8] } -> async Nat;
        transfer : shared TransferArgs -> async Nat64;
    } = actor(Principal.toText(ICP_LEDGER_CANISTER_ID));

    // Function to convert ICP to cycles with improved precision
    private func convertICPToCycles(icpE8s: Nat) : Nat {
        // Convert ICP (in e8s) to cycles
        // 1 ICP = 100_000_000 e8s = 5.3T cycles
        return (icpE8s * ICP_CYCLES_CONVERSION_RATE) / 100_000_000;
    };

    // Cycles wallet interface
    let wallet_actor : actor {
        wallet_send : { canister : Principal; amount : Nat64 } -> async Result.Result<Nat64, Text>;
    } = actor("yfalt-gaaaa-aaaag-at2lq-cai");

    private func performTopUp(canisterId: Principal, cyclesAmount: Nat) : async Result.Result<Nat, Text> {
        Debug.print("🔄 Starting top-up process for canister: " # Principal.toText(canisterId));
        Debug.print("💰 Cycles amount requested: " # Nat.toText(cyclesAmount));

        try {
            // Get current cycles balance
            let status = await management_canister.canister_status({ canister_id = canisterId });
            let currentCycles = status.cycles;
            Debug.print("📊 Current canister cycles: " # Nat.toText(currentCycles));

            // Check our own cycles balance
            let ourBalance = Cycles.balance();
            Debug.print("💰 Our cycles balance: " # Nat.toText(ourBalance));
            
            if (ourBalance < cyclesAmount) {
                Debug.print("❌ Insufficient cycles balance: " # Nat.toText(ourBalance) # " < " # Nat.toText(cyclesAmount));
                return #err("Insufficient cycles balance");
            };

            // Add cycles to the message
            Debug.print("💸 Adding cycles to message: " # Nat.toText(cyclesAmount));
            Cycles.add(cyclesAmount);
            
            // Deposit cycles to the target canister
            Debug.print("🔄 Depositing cycles...");
            let ic : IC = actor("aaaaa-aa");
            await ic.deposit_cycles({ canister_id = canisterId });
            
            // Get updated cycles balance
            let newStatus = await management_canister.canister_status({ canister_id = canisterId });
            let newCycles = newStatus.cycles;
            
            // Check if cycles were actually added
            if (newCycles <= currentCycles) {
                Debug.print("❌ Cycles were not added. Old balance: " # Nat.toText(currentCycles) # ", New balance: " # Nat.toText(newCycles));
                return #err("Cycles were not added to the canister");
            };
            
            let cyclesAdded = newCycles - currentCycles;
            Debug.print("✅ Top-up successful! Cycles added: " # Nat.toText(cyclesAdded));
            Debug.print("📈 New balance: " # Nat.toText(newCycles));
            #ok(cyclesAdded)
        } catch (e) {
            Debug.print("❌ Error during top-up: " # Error.message(e));
            #err("Error during top-up: " # Error.message(e))
        };
    };

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
    public shared(msg) func unregisterCanister(canisterId : Principal) : async Result.Result<(), AuthError> {
        let caller = msg.caller;
        
        if (Principal.isAnonymous(caller)) {
            return #err(#NotAuthenticated);
        };

        // Check if the canister exists and is owned by the caller
        switch (canisters.get(canisterId)) {
            case (?info) {
                if (info.owner != caller) {
                    return #err(#NotAuthenticated);
                };
                // Remove the canister from all data structures
                canisters.delete(canisterId);
                metrics.delete(canisterId);
                
                // Remove any rules associated with this canister
                let rulesToDelete = Iter.filter<(Text, Rule)>(rules.entries(), func((_, rule)) {
                    rule.canisterId != canisterId
                });
                rules := HashMap.fromIter<Text, Rule>(rulesToDelete, 10, Text.equal, Text.hash);
                
                #ok(())
            };
            case null {
                #err(#NotFound)
            };
        }
    };

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
        Debug.print("📊 Starting metrics update for canister: " # Principal.toText(canisterId));
        let caller = msg.caller;
        
        if (Principal.isAnonymous(caller)) {
            Debug.print("❌ Anonymous caller rejected");
            return #err(#NotAuthorized);
        };

        switch (canisters.get(canisterId)) {
            case (?info) {
                if (not Principal.equal(info.owner, caller)) {
                    Debug.print("❌ Unauthorized caller");
                    return #err(#NotAuthorized);
                };
                
                try {
                    Debug.print("🔍 Fetching canister status...");
                    let status = await management_canister.canister_status({ canister_id = canisterId });
                    Debug.print("💰 Current cycles: " # Nat.toText(status.cycles));
                    Debug.print("💾 Memory size: " # Nat.toText(status.memory_size));
                    
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
                        createdAt = info.createdAt;
                        subnetId = null;
                        storageUtilization = status.memory_size;
                        lastUpdated = Time.now();
                    };

                    metrics.put(canisterId, metricData);
                    Debug.print("✅ Metrics updated successfully");
                    #ok(())
                } catch (e) {
                    Debug.print("❌ Error updating metrics: " # Error.message(e));
                    #err(#UpdateFailed)
                };
            };
            case null {
                Debug.print("❌ Canister not found");
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
    // 
    

    public shared query(msg) func getICPBalance() : async Result.Result<Nat, RuleError> {
        let caller = msg.caller;
        
        if (Principal.isAnonymous(caller)) {
            return #err(#NotAuthorized);
        };

        #ok(Option.get(balances.get(caller), 0))
    };

    // Get actual ICP balance from ledger
    public shared(msg) func getAccountBalance(owner: Principal) : async Result.Result<Nat64, Text> {
        try {
            let balance = await ledger.icrc1_balance_of({ owner = owner; subaccount = null });
            #ok(Nat64.fromNat(balance))
        } catch (e) {
            #err("Failed to fetch balance: " # Error.message(e))
        }
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
    public shared(msg) func checkAndExecuteRules() : async Result.Result<Text, RuleError> {
        Debug.print("🔍 Starting rule check execution");
        let caller = msg.caller;
        
        if (Principal.isAnonymous(caller)) {
            Debug.print("❌ Anonymous caller rejected");
            return #err(#NotAuthorized);
        };

        var executedRules = 0;
        var errors = 0;
        
        for ((ruleId, rule) in rules.entries()) {
            if (rule.enabled) {
                var shouldProcess = true;
                
                // Check cooldown period
                switch (rule.lastTriggered) {
                    case (?lastTrigger) {
                        let timeSinceLastTrigger = Time.now() - lastTrigger;
                        if (timeSinceLastTrigger < rule.cooldownPeriod) {
                            Debug.print("⏳ Rule " # ruleId # " in cooldown period");
                            shouldProcess := false;
                        };
                    };
                    case null {};
                };

                if (shouldProcess) {
                    Debug.print("📋 Checking rule: " # ruleId);
                    
                    // Get current metrics
                    switch (metrics.get(rule.canisterId)) {
                        case (?currentMetrics) {
                            var shouldTrigger = false;
                            
                            // Check conditions
                            switch (rule.condition) {
                                case (#CyclesBelow(threshold)) {
                                    if (currentMetrics.cycles < threshold) {
                                        Debug.print("⚠️ Cycles below threshold: " # 
                                            Nat.toText(currentMetrics.cycles) # " < " # 
                                            Nat.toText(threshold));
                                        shouldTrigger := true;
                                    };
                                };
                                case (#MemoryUsageAbove(threshold)) {
                                    if (currentMetrics.memorySize > threshold) {
                                        Debug.print("⚠️ Memory usage above threshold");
                                        shouldTrigger := true;
                                    };
                                };
                                case (#ComputeAllocationAbove(threshold)) {
                                    if (currentMetrics.computeAllocation > threshold) {
                                        Debug.print("⚠️ Compute allocation above threshold");
                                        shouldTrigger := true;
                                    };
                                };
                            };

                            if (shouldTrigger) {
                                Debug.print("🎯 Rule triggered: " # ruleId);
                                
                                // Execute action
                                switch (rule.action) {
                                    case (#TopUpCycles(amount)) {
                                        Debug.print("💰 Executing top-up action");
                                        try {
                                            let topUpResult = await performTopUp(rule.canisterId, amount);
                                            switch (topUpResult) {
                                                case (#ok(topUpAmount)) {
                                                    Debug.print("✅ Top-up successful: " # Nat.toText(topUpAmount));
                                                    executedRules += 1;
                                                };
                                                case (#err(error)) {
                                                    Debug.print("❌ Top-up failed: " # error);
                                                    errors += 1;
                                                };
                                            };
                                        } catch (e) {
                                            Debug.print("❌ Error executing top-up: " # Error.message(e));
                                            errors += 1;
                                        };
                                    };
                                    case (#NotifyOwner(message)) {
                                        Debug.print("📧 Would send notification: " # message);
                                        executedRules += 1;
                                    };
                                    case (#AdjustComputeAllocation(newAllocation)) {
                                        Debug.print("⚙️ Would adjust compute allocation to: " # 
                                            Nat.toText(newAllocation));
                                        executedRules += 1;
                                    };
                                };

                                // Update last triggered time
                                let updatedRule : Rule = {
                                    id = rule.id;
                                    canisterId = rule.canisterId;
                                    condition = rule.condition;
                                    action = rule.action;
                                    enabled = rule.enabled;
                                    lastTriggered = ?Time.now();
                                    cooldownPeriod = rule.cooldownPeriod;
                                    owner = rule.owner;
                                };
                                rules.put(rule.id, updatedRule);
                            };
                        };
                        case null {
                            Debug.print("❌ No metrics found for canister: " # 
                                Principal.toText(rule.canisterId));
                        };
                    };
                };
            } else {
                Debug.print("⏭️ Skipping disabled rule: " # ruleId);
            };
        };

        let resultMessage = "Executed " # Int.toText(executedRules) # 
            " rules with " # Int.toText(errors) # " errors";
        Debug.print("✅ Rule check complete: " # resultMessage);
        #ok(resultMessage)
    };
};
