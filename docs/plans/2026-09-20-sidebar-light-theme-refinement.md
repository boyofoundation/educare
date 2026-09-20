# EduCare sidebar and light-theme refinement

## Product framing

EduCare is a daily teaching workspace for educators. The sidebar has one job: let a teacher
switch the current assistant or conversation and reach occasional workspace tools without
turning maintenance actions into primary navigation.

## Design direction

The visual direction is a quiet teaching console: crisp, calm, and closer to a well-indexed
lesson notebook than a generic admin dashboard. The distinctive element is a single cobalt
"notebook spine" marker for the current assistant/conversation; secondary actions remain neutral.

### Compact token set

| Token  | Dark      | Light     | Use                                  |
| ------ | --------- | --------- | ------------------------------------ |
| Ink    | `#F8FAFC` | `#172033` | Primary text                         |
| Slate  | `#A8B3C5` | `#526176` | Secondary text                       |
| Canvas | `#10151D` | `#F6F8FC` | App background                       |
| Paper  | `#171E28` | `#FFFFFF` | Sidebar and raised surfaces          |
| Rule   | `#334155` | `#CBD5E1` | Borders and separators               |
| Cobalt | `#22D3EE` | `#0E7490` | Current state, focus, primary action |

Typography stays with the project's Traditional Chinese system stack for loading performance
and glyph coverage. Hierarchy comes from weight, line-height, and restrained labels rather than
additional display faces.

## Information architecture

```text
Expanded sidebar                    Collapsed rail
┌──────────────────────────┐        ┌────┐
│ EduCare              [‹] │        │logo│
│ Assistant selector  [+][…]│        │ +  │ new chat
│ [ Search workspace ]     │        │ ⌕  │ search
├──────────────────────────┤        │ •  │ current/recent chats
│ Conversations       [⌃]  │        │ •  │
│ [+ New conversation]     │        │ …  │
│ ▌Current chat       2m   │        ├────┤
│   Recent chat       1h   │        │ ⚙  │ settings
│   … Show all (8)         │        └────┘
├──────────────────────────┤
│ Workspace           [⌄]  │  collapsed by default
│   HTML Canvas            │
│   Lesson practice        │
│   Data & collaboration   │
├──────────────────────────┤
│ Settings                 │
└──────────────────────────┘
```

- Keep the current task (assistant, search, new chat, recent chats) immediately visible.
- Default the occasional workspace group to collapsed, with all existing destinations retained.
- Show at most six chat rows initially; pinned chats sort first and “show all” reveals the rest.
- Replace row-level pin/rename/category/delete controls with one labelled overflow menu.
- Replace the assistant action strip with `New`, `Share`, and one labelled management menu.
- The desktop icon rail contains navigation only; management remains available after expansion.

## Self-critique before build

The first draft risked becoming another generic icon-heavy SaaS rail. It was revised to use text
labels in expanded mode, one accent color, no magenta callout, and a single active-state spine.
The unusual notebook-spine marker is kept because it encodes the current learning context; other
decoration and competing gradients are removed.

## Behavior and regression lock

- Existing destinations, assistant import/export/share/edit/delete, collaboration bundle import,
  project picker, token details, session pin/rename/category/delete, and desktop rail remain reachable.
- Section and menu triggers expose `aria-expanded` / accessible names; Escape closes transient menus.
- Drawer focus exclusion/return and desktop collapse persistence stay unchanged.
- Light theme uses semantic sidebar/shell tokens instead of broad `[role='navigation']` recoloring.
- Named text/control contrast targets WCAG AA (4.5:1 text, 3:1 control boundaries/focus).
- Verify at 390×844, 768×1024, and 1440×960 in headless Chromium, with screenshots for light/dark.
