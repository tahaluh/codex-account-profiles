import * as vscode from "vscode";

export interface AccountProfile {
  id: string;
  name: string;
  email?: string;
  planType?: string;
  codexHome: string;
  enabled: boolean;
  priority: number;
  lastLimitedAt?: number;
}

const KEY = "codexAccountProfiles.accounts";

export class AccountStore {
  constructor(private readonly state: vscode.Memento) {}

  all(): AccountProfile[] {
    return this.state.get<AccountProfile[]>(KEY, []);
  }

  async save(accounts: AccountProfile[]): Promise<void> {
    await this.state.update(KEY, accounts);
  }

  async add(name: string, codexHome: string, id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`): Promise<AccountProfile> {
    const accounts = this.all();
    const account: AccountProfile = {
      id,
      name,
      codexHome,
      enabled: true,
      priority: accounts.length,
    };
    await this.save([...accounts, account]);
    return account;
  }

  async markLimited(id: string): Promise<void> {
    await this.save(this.all().map((account) =>
      account.id === id ? { ...account, lastLimitedAt: Date.now() } : account,
    ));
  }

  async update(id: string, changes: Partial<AccountProfile>): Promise<void> {
    await this.save(this.all().map((account) =>
      account.id === id ? { ...account, ...changes } : account,
    ));
  }

  async remove(id: string): Promise<void> {
    await this.save(this.all().filter((account) => account.id !== id));
  }
}
