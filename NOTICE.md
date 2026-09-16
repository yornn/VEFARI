# VEFARI — implementation history and licensing

VEFARI is a standalone wardrobe extension for SillyTavern.

## Version 0.2.0

The prototype's wardrobe model, prompt construction, host integration, and image
adapter have been replaced with a command-based domain model, versioned storage,
a JSON wardrobe prompt, and adapters using SillyTavern's public API contracts.
The minimal VEFARI interface and test runner developed for the prototype are
retained and connected to the new implementation. No other extension is required
at runtime. The data migration reads only earlier VEFARI settings.

This is a technical rewrite, not a clean-room certification or a legal conclusion
that all possible derivative-work obligations have ended. The earlier source was
examined during development. The project keeps AGPL-3.0-or-later and records the
prototype's provenance rather than claiming it never existed.

## Earlier prototype (0.1.0)

The earlier prototype adapted the wardrobe approach and outfit injection from
**SLAY Images 5.0.0**. Its image-generation engine was not included.
The following original notices are preserved as historical attribution:

- SLAY Images: https://github.com/wewwaistyping/SLAYimages
  — Copyright (C) 2026 Wewwa (wewwaistyping).
- Wardrobe system: delidgi — https://github.com/delidgi/sillyimages
- SLAY also credits aceeenvw's notsosillynotsoimages and 0xl0cal's sillyimages
  for its original image-generation lineage.

## VEFARI

VEFARI development and modifications: Copyright (C) 2026 yornn.

Distributed under **GNU Affero General Public License, version 3 or later
(AGPL-3.0-or-later)**. The complete license is in LICENSE. The software is
provided without warranty. Preserve applicable notices and provide corresponding
source under the license when distributing or offering modified versions as a
network service where its terms require it.

VEFARI source: https://github.com/yornn/VEFARI