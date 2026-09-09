# Contributing documentation

Start with the [documentation map](../README.md).

For a product change, edit `docs/design` to describe desired behavior and acceptance criteria. If it changes an accepted decision, add a numbered `docs/adr` record explaining why, what alternatives mattered, and how the change will be verified.

For an implementation PR, add a record in `docs/architecure/changes` with a real PR link when available. State what code now does, how components communicate, which checks actually ran, and what remains unsupported. Mark local work unmerged. Update the architecture index and link affected ADRs/design sections.

For an operator workflow, write a wiki guide with prerequisites, concrete steps, expected outcomes, and troubleshooting. Identify instructions that still need real-device verification. Avoid treating design targets as available commands or UI.

Review links and commands with the same care as code. Keep credentials and private session URLs out of examples, logs, and screenshots.
