"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AccountStore = void 0;
const KEY = "codexAccountProfiles.accounts";
class AccountStore {
    state;
    constructor(state) {
        this.state = state;
    }
    all() {
        return this.state.get(KEY, []);
    }
    async save(accounts) {
        await this.state.update(KEY, accounts);
    }
    async add(name, codexHome, id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`) {
        const accounts = this.all();
        const account = {
            id,
            name,
            codexHome,
            enabled: true,
            priority: accounts.length,
        };
        await this.save([...accounts, account]);
        return account;
    }
    async markLimited(id) {
        await this.save(this.all().map((account) => account.id === id ? { ...account, lastLimitedAt: Date.now() } : account));
    }
    async update(id, changes) {
        await this.save(this.all().map((account) => account.id === id ? { ...account, ...changes } : account));
    }
    async remove(id) {
        await this.save(this.all().filter((account) => account.id !== id));
    }
}
exports.AccountStore = AccountStore;
//# sourceMappingURL=accountStore.js.map