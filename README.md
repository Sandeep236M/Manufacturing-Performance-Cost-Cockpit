# Machining Plant Performance Sim

A browser-based discrete-event simulation of a valve body machining plant: three lines of seven stations each, with operators, maintenance techs, a forklift and a rework bench working from live floor state. It connects what happens on the floor to the numbers an industrial engineer is accountable for:

- Capacity planning against takt, with an analytical capacity model beside the simulation
- Line balancing and bottleneck analysis
- Labor planning: required vs. actual operators, balanced work zones, labor efficiency
- OEE split into availability, performance and quality, with a loss tree
- Unit cost (COGS) vs. standard: material and scrap, direct labor, variable and fixed overhead
- Scrap and yield by source
- CAPEX and improvement projects with annual benefit and payback, installed live
- Scenario analysis: demand, shifts, crew size, breakdowns

Plain HTML, CSS and JavaScript. No build step, no dependencies. A companion to [Robotics Plant Floor Sim](https://sandeep236m.github.io/Robotics-plant-simulation/).

## Files

| File | Purpose |
|---|---|
| `index.html` | Page layout: controls, KPI strip, floor canvas, line balance, inspector, OEE, unit cost, capacity and CAPEX panels, event log |
| `styles.css` | Styling, with light and dark themes that follow the OS setting |
| `app.js` | Simulation engine, operator and maintenance logic, analytical capacity model, cost model, rendering, guided tour |
| `.nojekyll` | Tells GitHub Pages to serve files as-is |

## Run locally

Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## Publish on GitHub Pages

1. Create a public repository, e.g. `machining-plant-sim`.
2. Upload these files, or push with git:
   ```bash
   git init && git add . && git commit -m "Machining Plant Performance Sim"
   git branch -M main
   git remote add origin https://github.com/<your-username>/machining-plant-sim.git
   git push -u origin main
   ```
3. Go to **Settings → Pages**. Set the source to **Deploy from a branch**, the branch to **main**, and the folder to **/ (root)**.
4. The site will be live at `https://<your-username>.github.io/machining-plant-sim/`.

## Controls

| Control | What it does |
|---|---|
| Speed | 1× to 60×. At 1×, one second on screen is one planned minute on the floor. |
| Demand | Daily plan of 2,000, 2,400 or 2,800 units, split evenly across the running lines. Sets takt. |
| Shifts | 2 or 3 shifts of 450 planned minutes. A third shift adds $3k/day fixed cost. |
| Crew per line | 3, 4 or 5 operators. Stations are split into balanced work zones for the crew. |
| Breakdowns | Random machine failures with andon, dispatch and repair. |
| Improvement projects | Install or remove PM, SMED, tool-wear monitoring, a replacement CNC or a fourth line. The floor changes immediately. |
| Tour | Seven steps from the floor layout to the constraint, OEE, unit cost, labor, CAPEX and scenarios. |

## What it models

**Flow.** Castings are pulled from a line-side bin (60 parts, refilled by forklift at 15) through Load & saw, CNC-1 turning, CNC-2 milling, Deburr & wash, Robotic weld, Leak test & inspect, and Pack. Conveyors between stations hold three parts, so a slow or stopped station blocks everything upstream and starves everything downstream.

**The constraint.** Lines 1 and 2 are balanced to a 58 s constraint. Line 3 runs an older CNC-2: 71 s cycle, about 5 h MTBF, 45 min MTTR and more than twice the dimensional defect rate.

**Changeovers and tooling.** Each line alternates two variants in batches of 300. Machines change over when the new variant reaches them, or pre-stage once they have run out of the old variant. CNCs change tools every 400 parts.

**Labor.** Manual stations need an operator for the whole cycle; machines need one only to load. Operators work their own zone first, help the next station over when idle, and break off manual work to load a waiting machine. Walking time is modeled.

**Maintenance.** Failures raise an andon. The nearest free tech walks over and repairs; downtime includes response time.

**Quality.** Defects are created at CNC-1, CNC-2 (dimensional) and weld (porosity) and found at inspection. Dimensional defects are scrapped 70% of the time, porosity 40%; the rest go to the rework bench (12 min) and are packed.

## KPIs

| KPI | Definition |
|---|---|
| Good units | Units packed, including reworked units |
| Plan attainment | Good units ÷ plan to date (daily demand × elapsed planned time) |
| Run rate | Good units in the last 2 hours, scaled to a day |
| Plant OEE | Σ(good units × ideal cycle of the line constraint) ÷ Σ planned time |
| Cost / good unit | Material + direct labor + variable overhead + fixed overhead, ÷ good units |
| Scrap rate | Scrapped ÷ (good + scrapped) |
| First pass yield | Passed inspection on the first attempt ÷ inspected |
| Labor efficiency | Earned hours ÷ paid operator hours. Earned = good units × standard crew × (standard cycle ÷ target OEE) |
| WIP and flow time | Units on the floor; flow time from Little's Law (WIP ÷ throughput) |
| Constraint | The line with the least capacity relative to its share of demand, and its slowest station |

**OEE by line** is measured at each line's constraint. Availability = (planned − breakdowns − changeovers − tool changes − material shortage) ÷ planned. Quality = good ÷ (good + scrap). Performance = OEE ÷ (A × Q), so waiting for an operator and starved or blocked time land in performance, and A × P × Q equals OEE exactly.

## Planning rules in the capacity panel

| What | Rule |
|---|---|
| Takt | Planned seconds per day ÷ (demand ÷ lines) |
| Line availability | Π over machines of MTBF ÷ (MTBF + MTTR + 8 min response) |
| Line capacity | (planned time − changeover − tool change losses) ÷ constraint cycle × availability × 95% × (1 − scrap) |
| Required operators | Manual work content × units per line ÷ (planned seconds × 70% allowance for PF&D and walking) |
| Project benefit | Change in (units sold × contribution margin − scrap material − added labor and fixed cost) × 250 days |
| Payback | Capex ÷ annual benefit |

The simulation and the analytical model are independent. Comparing them is part of the point: the model is what you would put in a capacity plan, the simulation shows whether the floor actually delivers it.

## Tuning

All assumptions sit at the top of `app.js`:

| What | Where |
|---|---|
| Costs, price, standard crew and scrap, target OEE | `COST` |
| Batch size, buffers, bin sizes, tool life, rework time, walking speed | `PROC` |
| Stations, cycle times, MTBF, MTTR, defect rates | `ST` |
| Line 3's older CNC-2 | `LINE_OVR` |
| Improvement projects and their effects | `PROJ` and `effSt()` |

All figures are illustrative planning assumptions, not measured data. 1 floor unit ≈ 0.5 m.
