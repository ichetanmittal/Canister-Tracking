import Principal "mo:base/Principal";
import HashMap "mo:base/HashMap";
import Error "mo:base/Error";
import Result "mo:base/Result";
import Text "mo:base/Text";
import Option "mo:base/Option";
import Iter "mo:base/Iter";

actor {
    // Types
    type UserId = Principal;
    type AuthError = {
        #NotAuthenticated;
        #AlreadyExists;
        #NotFound;
    };

    // State
    private stable var registeredUsers : [(Principal, Text)] = [];
    private var users = HashMap.HashMap<Principal, Text>(10, Principal.equal, Principal.hash);

    // Initialize state
    system func preupgrade() {
        registeredUsers := Iter.toArray(users.entries());
    };

    system func postupgrade() {
        users := HashMap.fromIter<Principal, Text>(registeredUsers.vals(), 10, Principal.equal, Principal.hash);
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
};
