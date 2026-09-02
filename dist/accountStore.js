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
    async setEnabled(id, enabled) {
        await this.update(id, { enabled });
    }
    async move(id, direction) {
        const accounts = [...this.all()].sort((a, b) => a.priority - b.priority);
        const index = accounts.findIndex((account) => account.id === id);
        const target = index + direction;
        if (index < 0 || target < 0 || target >= accounts.length)
            return;
        [accounts[index], accounts[target]] = [accounts[target], accounts[index]];
        await this.save(accounts.map((account, priority) => ({ ...account, priority })));
    }
    async remove(id) {
        await this.save(this.all().filter((account) => account.id !== id));
    }
}
exports.AccountStore = AccountStore;
//# sourceMappingURL=accountStore.js.map