"""The first run's Python agent.

It appends what happens to it to --log: `up <pid>` at start, `child <pid>`
for a child it starts, and, with --handler, `signal <name>` for each console
event; on SIGBREAK it then exits 0. --orphan starts a long-running child and
exits 300 ms later.
"""

import argparse
import os
import signal
import subprocess
import sys
import time

parser = argparse.ArgumentParser()
parser.add_argument("--log", required=True)
parser.add_argument("--handler", action="store_true")
parser.add_argument("--orphan", action="store_true")
args = parser.parse_args()


def log(line):
    with open(args.log, "a", encoding="utf-8") as file:
        file.write(line + "\n")


if args.handler:

    def on_int(_signum, _frame):
        log("signal SIGINT")

    def on_break(_signum, _frame):
        log("signal SIGBREAK")
        sys.exit(0)

    signal.signal(signal.SIGINT, on_int)
    signal.signal(signal.SIGBREAK, on_break)

log(f"up {os.getpid()}")
if args.orphan:
    child = subprocess.Popen(
        [sys.executable, "-c", "import time\nwhile True: time.sleep(1)"],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    log(f"child {child.pid}")
    time.sleep(0.3)
    sys.exit(0)
while True:
    time.sleep(0.2)
