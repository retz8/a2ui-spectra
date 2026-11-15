/**
 * The Win32 calls Spectra makes on Windows, through `bun:ffi`: the Job Object
 * that holds the agent's process tree, and the console's control events. Only
 * the compiled binary makes them; under Node `loadWin32()` resolves undefined.
 */

/** The part of `bun:ffi` used here. */
interface BunFfi {
  dlopen(
    name: string,
    symbols: Record<string, {args: readonly string[]; returns: string}>,
  ): {symbols: Record<string, (...args: unknown[]) => unknown>};
}

/** A call that failed, with the error Windows gave. */
export class Win32Error extends Error {
  constructor(
    readonly call: string,
    readonly code: number,
  ) {
    super(`${call} failed with Windows error ${code}`);
  }
}

/** The console events a process can send to a console's process group. */
export type ConsoleEvent = 'ctrl-c' | 'ctrl-break';

export interface Win32 {
  /** A new Job Object whose processes all end when its last handle closes. */
  createJob(): bigint;
  /** Puts the process into the job; every process it starts from then on is in the job too. */
  assignToJob(job: bigint, pid: number): void;
  /** How many processes the job holds that are still running. */
  activeProcesses(job: bigint): number;
  /** The ids of the job's processes that are still running. */
  processIds(job: bigint): number[];
  /** Ends every process in the job, with the exit code given. */
  terminateJob(job: bigint, exitCode: number): void;
  closeHandle(handle: bigint): void;
  /**
   * Sends the event to the process group led by `groupId` on this process's
   * console, or to every process on it for 0. False when it could not be sent,
   * as when this process has no console.
   */
  sendConsoleEvent(event: ConsoleEvent, groupId: number): boolean;
  /** Attaches this process to its parent's console; false when it could not. */
  attachParentConsole(): boolean;
  /** Detaches this process from its console, so that the console's events no longer reach it. */
  freeConsole(): void;
  /** Whether this process is in a job of any kind. */
  inAnyJob(): boolean;
  /** Whether the process with that id is still running. */
  processRunning(pid: number): boolean;
  /**
   * A handle to the process with that id, for its exit code once it has
   * exited: the process stays readable while the handle is open.
   */
  openProcess(pid: number): bigint;
  /** The whole exit code of an exited process, past the eight bits Bun passes on. */
  exitCodeOf(handle: bigint): number | undefined;
}

const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
const JOB_OBJECT_BASIC_ACCOUNTING_INFORMATION = 1;
const JOB_OBJECT_BASIC_PROCESS_ID_LIST = 3;
const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION = 9;
/** sizeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION) on x64. */
const EXTENDED_LIMIT_SIZE = 144;
/** The offset of BasicLimitInformation.LimitFlags in it. */
const LIMIT_FLAGS_OFFSET = 16;
/** sizeof(JOBOBJECT_BASIC_ACCOUNTING_INFORMATION). */
const ACCOUNTING_SIZE = 48;
/** The offset of ActiveProcesses in it. */
const ACTIVE_PROCESSES_OFFSET = 40;
/** How many process ids one query of the job's list reads. */
const PROCESS_ID_LIST_LENGTH = 1024;

const PROCESS_TERMINATE = 0x0001;
const PROCESS_SET_QUOTA = 0x0100;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const STILL_ACTIVE = 259;
const ATTACH_PARENT_PROCESS = 0xffffffff;
const CTRL_C_EVENT = 0;
const CTRL_BREAK_EVENT = 1;

/** `bun:ffi`'s name, kept out of a literal import so that Node and tsc never resolve it. */
const BUN_FFI = 'bun:ffi';

let loaded: Promise<Win32 | undefined> | undefined;

/** The Win32 calls, under the compiled binary on Windows; undefined anywhere else. */
export function loadWin32(): Promise<Win32 | undefined> {
  loaded ??= load();
  return loaded;
}

async function load(): Promise<Win32 | undefined> {
  if (process.platform !== 'win32' || process.versions.bun === undefined) {
    return undefined;
  }
  const ffi = (await import(BUN_FFI)) as BunFfi;
  // HANDLE is u64: bun:ffi's documentation says a pointer type does not carry one.
  const {symbols: k} = ffi.dlopen('kernel32.dll', {
    CreateJobObjectW: {args: ['ptr', 'ptr'], returns: 'u64'},
    SetInformationJobObject: {args: ['u64', 'i32', 'buffer', 'u32'], returns: 'i32'},
    QueryInformationJobObject: {args: ['u64', 'i32', 'buffer', 'u32', 'ptr'], returns: 'i32'},
    AssignProcessToJobObject: {args: ['u64', 'u64'], returns: 'i32'},
    TerminateJobObject: {args: ['u64', 'u32'], returns: 'i32'},
    IsProcessInJob: {args: ['u64', 'u64', 'buffer'], returns: 'i32'},
    OpenProcess: {args: ['u32', 'i32', 'u32'], returns: 'u64'},
    GetExitCodeProcess: {args: ['u64', 'buffer'], returns: 'i32'},
    GetCurrentProcess: {args: [], returns: 'u64'},
    CloseHandle: {args: ['u64'], returns: 'i32'},
    GenerateConsoleCtrlEvent: {args: ['u32', 'u32'], returns: 'i32'},
    AttachConsole: {args: ['u32'], returns: 'i32'},
    FreeConsole: {args: [], returns: 'i32'},
    GetLastError: {args: [], returns: 'u32'},
  });
  const call = <T>(name: string, ...args: unknown[]): T => k[name]!(...args) as T;
  const fail = (name: string): never => {
    throw new Win32Error(name, call<number>('GetLastError'));
  };
  const openProcess = (access: number, pid: number): bigint => {
    const handle = call<bigint>('OpenProcess', access, 0, pid);
    return handle === 0n ? fail('OpenProcess') : handle;
  };
  return {
    createJob() {
      const job = call<bigint>('CreateJobObjectW', null, null);
      if (job === 0n) fail('CreateJobObjectW');
      const info = new Uint8Array(EXTENDED_LIMIT_SIZE);
      new DataView(info.buffer).setUint32(
        LIMIT_FLAGS_OFFSET,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        true,
      );
      if (
        call<number>(
          'SetInformationJobObject',
          job,
          JOB_OBJECT_EXTENDED_LIMIT_INFORMATION,
          info,
          info.byteLength,
        ) === 0
      ) {
        const error = new Win32Error('SetInformationJobObject', call<number>('GetLastError'));
        call('CloseHandle', job);
        throw error;
      }
      return job;
    },
    assignToJob(job, pid) {
      const process = openProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, pid);
      try {
        if (call<number>('AssignProcessToJobObject', job, process) === 0) {
          fail('AssignProcessToJobObject');
        }
      } finally {
        call('CloseHandle', process);
      }
    },
    activeProcesses(job) {
      const info = new Uint8Array(ACCOUNTING_SIZE);
      if (
        call<number>(
          'QueryInformationJobObject',
          job,
          JOB_OBJECT_BASIC_ACCOUNTING_INFORMATION,
          info,
          info.byteLength,
          null,
        ) === 0
      ) {
        fail('QueryInformationJobObject');
      }
      return new DataView(info.buffer).getUint32(ACTIVE_PROCESSES_OFFSET, true);
    },
    processIds(job) {
      const info = new Uint8Array(8 + 8 * PROCESS_ID_LIST_LENGTH);
      // ERROR_MORE_DATA still fills the list as far as it goes.
      call<number>(
        'QueryInformationJobObject',
        job,
        JOB_OBJECT_BASIC_PROCESS_ID_LIST,
        info,
        info.byteLength,
        null,
      );
      const view = new DataView(info.buffer);
      const listed = view.getUint32(4, true);
      const ids: number[] = [];
      for (let index = 0; index < Math.min(listed, PROCESS_ID_LIST_LENGTH); index++) {
        ids.push(Number(view.getBigUint64(8 + 8 * index, true)));
      }
      return ids;
    },
    terminateJob(job, exitCode) {
      if (call<number>('TerminateJobObject', job, exitCode) === 0) fail('TerminateJobObject');
    },
    closeHandle(handle) {
      call('CloseHandle', handle);
    },
    sendConsoleEvent(event, groupId) {
      const code = event === 'ctrl-c' ? CTRL_C_EVENT : CTRL_BREAK_EVENT;
      return call<number>('GenerateConsoleCtrlEvent', code, groupId) !== 0;
    },
    attachParentConsole() {
      return call<number>('AttachConsole', ATTACH_PARENT_PROCESS) !== 0;
    },
    freeConsole() {
      call('FreeConsole');
    },
    inAnyJob() {
      const result = new Uint8Array(4);
      if (call<number>('IsProcessInJob', call<bigint>('GetCurrentProcess'), 0n, result) === 0) {
        fail('IsProcessInJob');
      }
      return new DataView(result.buffer).getInt32(0, true) !== 0;
    },
    openProcess(pid) {
      return openProcess(PROCESS_QUERY_LIMITED_INFORMATION, pid);
    },
    exitCodeOf(handle) {
      const code = new Uint8Array(4);
      if (call<number>('GetExitCodeProcess', handle, code) === 0) return undefined;
      const value = new DataView(code.buffer).getUint32(0, true);
      return value === STILL_ACTIVE ? undefined : value;
    },
    processRunning(pid) {
      let handle: bigint;
      try {
        handle = openProcess(PROCESS_QUERY_LIMITED_INFORMATION, pid);
      } catch {
        return false;
      }
      try {
        const code = new Uint8Array(4);
        if (call<number>('GetExitCodeProcess', handle, code) === 0) return false;
        return new DataView(code.buffer).getUint32(0, true) === STILL_ACTIVE;
      } finally {
        call('CloseHandle', handle);
      }
    },
  };
}
