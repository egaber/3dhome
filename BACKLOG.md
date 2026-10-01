# Feature inbox

Add one feature per unchecked Markdown checkbox. The local factory imports each
unique title once, adds testable acceptance criteria, and tracks its progress in
[tasks.json](tasks.json). Only actual unchecked checkbox lines are imported.

Describe the user-visible behavior, constraints, and expected result in the title.
For longer specifications, add a task with a description and acceptance criteria to
the board while the factory is paused. Do not put credentials in backlog items.

There are intentionally no enabled sample features. Importing a real feature
authorizes local implementation and consumes Copilot quota, but never publishes it.