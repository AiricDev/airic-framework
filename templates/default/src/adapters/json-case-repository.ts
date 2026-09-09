import { mkdir, open, readFile, rename } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { CaseRepository } from "../application/case-service.js";
import type { CaseRecord } from "../domain/case.js";

interface State {
  cases: Record<string, CaseRecord>;
  receipts: Record<string, { commandId: string; record: CaseRecord }>;
}

export class JsonCaseRepository implements CaseRepository {
  readonly #path: string;
  #writes: Promise<void> = Promise.resolve();

  constructor(path: string) {
    this.#path = resolve(path);
  }

  async initialize(): Promise<void> {
    await mkdir(dirname(this.#path), { recursive: true });
    try {
      await readFile(this.#path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await this.#write({ cases: { demo: { id: "demo", status: "draft", revision: 1 } }, receipts: {} });
    }
  }

  async get(id: string): Promise<CaseRecord | undefined> {
    return (await this.#read()).cases[id];
  }

  async inspect(commandId: string) {
    return (await this.#read()).receipts[commandId];
  }

  async commit(commandId: string, current: CaseRecord, next: CaseRecord) {
    const operation = this.#writes.then(() => this.#commitOnce(commandId, current, next));
    this.#writes = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async #commitOnce(commandId: string, current: CaseRecord, next: CaseRecord) {
    const state = await this.#read();
    const prior = state.receipts[commandId];
    if (prior) return prior;
    if (state.cases[current.id]?.revision !== current.revision) throw new Error("Concurrent domain revision changed");
    const receipt = { commandId, record: next };
    await this.#write({ cases: { ...state.cases, [next.id]: next }, receipts: { ...state.receipts, [commandId]: receipt } });
    return receipt;
  }

  async #read(): Promise<State> {
    return JSON.parse(await readFile(this.#path, "utf8")) as State;
  }

  async #write(state: State): Promise<void> {
    const temporary = `${this.#path}.tmp`;
    const handle = await open(temporary, "w", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, this.#path);
  }
}
