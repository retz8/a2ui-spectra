"""The tests' console helper on Windows, which only the tests use.

`run -- <command>...` starts the command in a console of its own, its window
hidden, with no input and this process's stdout and stderr, in a Job Object
that ends it when this process ends. Each line written to this process's
stdin, `ctrl-c`, `ctrl-break` or `close`, sends that console event to the
command's console, or closes that console's window, without it reaching any
other console. This process exits with the command's exit code.

`send <ctrl-c|ctrl-break|close> <pid>` does the same once, to the console of
the process with that id.
"""

import ctypes
import subprocess
import sys
import threading
import time
from ctypes import wintypes

kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
user32 = ctypes.WinDLL("user32", use_last_error=True)

CREATE_NEW_CONSOLE = 0x00000010
STARTF_USESHOWWINDOW = 0x00000001
SW_HIDE = 0
CTRL_C_EVENT = 0
CTRL_BREAK_EVENT = 1
WM_CLOSE = 0x0010
JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000
JOB_OBJECT_EXTENDED_LIMIT_INFORMATION = 9

HANDLER_ROUTINE = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.DWORD)


class IO_COUNTERS(ctypes.Structure):
    _fields_ = [
        ("ReadOperationCount", ctypes.c_ulonglong),
        ("WriteOperationCount", ctypes.c_ulonglong),
        ("OtherOperationCount", ctypes.c_ulonglong),
        ("ReadTransferCount", ctypes.c_ulonglong),
        ("WriteTransferCount", ctypes.c_ulonglong),
        ("OtherTransferCount", ctypes.c_ulonglong),
    ]


class JOBOBJECT_BASIC_LIMIT_INFORMATION(ctypes.Structure):
    _fields_ = [
        ("PerProcessUserTimeLimit", ctypes.c_int64),
        ("PerJobUserTimeLimit", ctypes.c_int64),
        ("LimitFlags", wintypes.DWORD),
        ("MinimumWorkingSetSize", ctypes.c_size_t),
        ("MaximumWorkingSetSize", ctypes.c_size_t),
        ("ActiveProcessLimit", wintypes.DWORD),
        ("Affinity", ctypes.c_size_t),
        ("PriorityClass", wintypes.DWORD),
        ("SchedulingClass", wintypes.DWORD),
    ]


class JOBOBJECT_EXTENDED_LIMIT_INFORMATION(ctypes.Structure):
    _fields_ = [
        ("BasicLimitInformation", JOBOBJECT_BASIC_LIMIT_INFORMATION),
        ("IoInfo", IO_COUNTERS),
        ("ProcessMemoryLimit", ctypes.c_size_t),
        ("JobMemoryLimit", ctypes.c_size_t),
        ("PeakProcessMemoryUsed", ctypes.c_size_t),
        ("PeakJobMemoryUsed", ctypes.c_size_t),
    ]


kernel32.CreateJobObjectW.restype = wintypes.HANDLE
kernel32.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
kernel32.SetInformationJobObject.argtypes = [
    wintypes.HANDLE,
    ctypes.c_int,
    ctypes.c_void_p,
    wintypes.DWORD,
]
kernel32.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
kernel32.AttachConsole.argtypes = [wintypes.DWORD]
kernel32.GenerateConsoleCtrlEvent.argtypes = [wintypes.DWORD, wintypes.DWORD]
kernel32.GetConsoleWindow.restype = wintypes.HWND
kernel32.SetConsoleCtrlHandler.argtypes = [HANDLER_ROUTINE, wintypes.BOOL]
kernel32.ExitProcess.argtypes = [wintypes.UINT]
user32.PostMessageW.argtypes = [
    wintypes.HWND,
    wintypes.UINT,
    wintypes.WPARAM,
    wintypes.LPARAM,
]

EVENTS = ("ctrl-c", "ctrl-break", "close")

# Kept for the life of the process: the handler that keeps a sent event from ending it.
_ignore = HANDLER_ROUTINE(lambda _event: True)


def send(event: str, pid: int) -> int:
    """Sends the event to the console of the process with that id."""
    kernel32.SetConsoleCtrlHandler(_ignore, True)
    kernel32.FreeConsole()
    if not kernel32.AttachConsole(pid):
        error = ctypes.get_last_error()
        print(
            f"Could not attach to the console of {pid}: error {error}", file=sys.stderr
        )
        return 2
    try:
        if event == "close":
            window = kernel32.GetConsoleWindow()
            if not window:
                print(f"The console of {pid} has no window", file=sys.stderr)
                return 3
            if not user32.PostMessageW(window, WM_CLOSE, 0, 0):
                error = ctypes.get_last_error()
                print(
                    f"Could not close the console of {pid}: error {error}",
                    file=sys.stderr,
                )
                return 4
            return 0
        if not kernel32.GenerateConsoleCtrlEvent(
            CTRL_C_EVENT if event == "ctrl-c" else CTRL_BREAK_EVENT, 0
        ):
            error = ctypes.get_last_error()
            print(f"Could not send {event} to {pid}: error {error}", file=sys.stderr)
            return 5
        # The event reaches each process on its own thread; this one stays until it has.
        time.sleep(0.2)
        return 0
    finally:
        kernel32.FreeConsole()


def run(command: list[str]) -> int:
    """Runs the command in a console of its own, taking events on stdin."""
    job = kernel32.CreateJobObjectW(None, None)
    info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION()
    info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    kernel32.SetInformationJobObject(
        job,
        JOB_OBJECT_EXTENDED_LIMIT_INFORMATION,
        ctypes.byref(info),
        ctypes.sizeof(info),
    )
    startupinfo = subprocess.STARTUPINFO()
    startupinfo.dwFlags |= STARTF_USESHOWWINDOW
    startupinfo.wShowWindow = SW_HIDE
    child = subprocess.Popen(
        command,
        stdin=subprocess.DEVNULL,
        creationflags=CREATE_NEW_CONSOLE,
        startupinfo=startupinfo,
    )
    kernel32.AssignProcessToJobObject(job, int(child._handle))  # type: ignore[attr-defined]

    def take_events() -> None:
        for line in sys.stdin:
            event = line.strip()
            if event in EVENTS:
                subprocess.run(
                    [sys.executable, __file__, "send", event, str(child.pid)]
                )

    threading.Thread(target=take_events, daemon=True).start()
    return child.wait()


def main() -> None:
    args = sys.argv[1:]
    if len(args) == 3 and args[0] == "send" and args[1] in EVENTS:
        code = send(args[1], int(args[2]))
    elif len(args) >= 3 and args[0] == "run" and args[1] == "--":
        code = run(args[2:])
    else:
        print(__doc__, file=sys.stderr)
        code = 64
    sys.stdout.flush()
    sys.stderr.flush()
    # ExitProcess carries a code past a signed int, as an NTSTATUS one is.
    kernel32.ExitProcess(code & 0xFFFFFFFF)


if __name__ == "__main__":
    main()
