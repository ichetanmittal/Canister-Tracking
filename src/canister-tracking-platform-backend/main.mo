import Principal "mo:base/Principal";
import HashMap "mo:base/HashMap";
import Error "mo:base/Error";
import Result "mo:base/Result";
import Text "mo:base/Text";
import Option "mo:base/Option";
import Iter "mo:base/Iter";
import Time "mo:base/Time";

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

    // State
    private stable var registeredUsers : [(Principal, Text)] = [];
    private var users = HashMap.HashMap<Principal, Text>(10, Principal.equal, Principal.hash);

    private stable var registeredCanisters : [(CanisterId, CanisterInfo)] = [];
    private var canisters = HashMap.HashMap<CanisterId, CanisterInfo>(10, Principal.equal, Principal.hash);

    // Initialize state
    system func preupgrade() {
        registeredUsers := Iter.toArray(users.entries());
        registeredCanisters := Iter.toArray(canisters.entries());
    };

    system func postupgrade() {
        users := HashMap.fromIter<Principal, Text>(registeredUsers.vals(), 10, Principal.equal, Principal.hash);
        canisters := HashMap.fromIter<CanisterId, CanisterInfo>(registeredCanisters.vals(), 10, Principal.equal, Principal.hash);
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
};
