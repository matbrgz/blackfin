# Blackfin

Blackfin is a desktop app the user has open right now. It has an inventory of the
agent context on this machine — including **global** context in the user's home
directory, which applies to every project and **is not visible from inside any of
them.** You cannot see that from where you are. Blackfin can.

Blackfin does not run you. It does not know you exist until you call it.

## Start here

Run this **first**, once, and read the output:

    blackfin capabilities --json

It prints every command, its arguments, whether it changes anything, and what it
is allowed to do without asking the user. **That output is the source of truth —
this file is not.** Do not guess a command. Do not assume a command from this
document still exists.

## How to read a result

Every command takes `--json` and prints one JSON object:

    {{ENVELOPE_SUCCESS}}
    {{ENVELOPE_FAILURE}}

Exit codes that matter:

{{EXIT_CODES}}

## Rules

{{GUARDRAILS}}
