# Case Study: SiC Inverter for a 2W EV Maker

*How a fast-growing electric two-wheeler company brought its traction inverter in-house and improved range by 9% with Nanoforge.*

## The customer

A leading Indian electric two-wheeler maker (name withheld at the customer's request) sells performance scooters and a commuter motorcycle across India. By early 2025 it was shipping more than 150,000 vehicles a year, all using a traction inverter bought from an overseas supplier.

## The challenge

The imported inverter had become the company's biggest bottleneck:

- **Lead times** of 16 to 20 weeks meant the company had to forecast demand almost two quarters ahead.
- **Limited tuning.** The supplier's firmware was closed, so the engineering team could not optimise motor control for Indian traffic and heat.
- **Efficiency.** The IGBT-based design lost range in stop-start city riding, where scooters spend most of their time.
- **Localization targets.** New state incentive rules rewarded higher domestic value addition in the drivetrain.

The company's Head of Power Electronics set a goal: design and build a 12 kW inverter in-house, in production within 14 months, with at least 5% more range and a domestic supply chain for the power stage.

## The solution

Nanoforge worked with the customer's power electronics team from the first architecture review.

1. **Power stage.** The team chose a ForgeSiC 650 V, 400 A half-bridge module, assembled and tested at a partner OSAT in Karnataka. Silicon carbide cut switching losses sharply at partial load, which dominates city riding.
2. **Gate drive.** NF-GD isolated gate drivers with desaturation protection and active Miller clamp simplified the layout and protected the modules during fault events.
3. **Battery link.** CellGuard 16-cell monitors in the new 4 kWh pack shared a common communication and diagnostics scheme with the inverter.
4. **Reference design.** Nanoforge's 12 kW reference inverter gave the team a proven starting point for layout, thermal design and EMC.
5. **Local support.** Two field application engineers from our Hyderabad and Pune offices spent six weeks in the customer's lab during bring-up, and our failure-analysis lab turned around three early-stage returns in under 72 hours.

## The results

| Metric | Before | After |
|---|---|---|
| Inverter peak efficiency | 96.1% | 98.7% |
| City-cycle range | 112 km | 122 km |
| Inverter lead time | 16-20 weeks | 5 weeks |
| Domestic value addition (inverter) | 12% | 58% |
| Inverter volume (weight) | baseline | -22% |

The in-house inverter entered production eleven months after kick-off, three months ahead of plan. Range improved by 9% on the company's city test cycle, and warranty claims on the drivetrain fell by 40% in the first two quarters.

Under a Strategic Allocation agreement, Nanoforge holds eight weeks of buffer stock in Hyderabad, and the customer has visibility of module allocation 24 months ahead.

## In the customer's words

> "Moving to silicon carbide and bringing the inverter in-house was the biggest engineering decision we have made. Nanoforge's engineers sat with our team through every step, and having modules made and tested in India changed how we plan production."
> — Head of Power Electronics, electric two-wheeler maker

## What's next

The customer is now developing a 25 kW inverter for a motorcycle platform and an on-board charger based on ForgeSiC modules. Nanoforge is supporting both programmes with its Pune applications team.

*Talk to us about your inverter programme at nanoforge-semiconductor.example.*
