# Frontend — notes

Fixed a start-up crash: the Basicity-B2 KPI tile had no `-sub` element, so clearing the
KPIs on load threw a TypeError and stopped the render loop. `setKPI` is now null-safe and
B2 has its `-sub` id. Added on-screen error reporting/watchdog and a **5× real-time**
playback option (Pause · 1× · 5× · 10× · 100× · 1000×).

API calls use an absolute base from `config.js` (set it to your Render URL). `""` = same-origin.
