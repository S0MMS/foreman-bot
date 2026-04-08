---
name: BURGER VIEW Feature
description: Completed BURGER VIEW feature for MFP iOS — implementation details and files changed
type: project
---

# BURGER VIEW Feature (completed 2026-03-13)

Feature request: Add a "Burger View" item to the More menu that shows a scrollable list of every cheeseburger the user has ever logged.

## Files Modified
- `Sources/Classic/ViewControllers/MoreViewController.h` — added `MFPMoreRowTypeBurgerView` to enum
- `Sources/Classic/ViewControllers/MoreViewController.m` — added menu item + tap handler (pushes `BurgerViewHostingController`)
- `Sources/Modern/Core/Models/FoodEntry.swift` — added `fetchCheeseburgerEntries(for:)` static method (filters last 2 years of diary entries by "cheeseburger" in food name)

## Files Created
- `Sources/Modern/Core/ViewModels/BurgerViewViewModel.swift` — `@MainActor ObservableObject`, loads entries async
- `Sources/Modern/Core/Views/BurgerListView.swift` — SwiftUI list view + `@objc BurgerViewHostingController` wrapper for Obj-C interop
- `mfpUnitTests/BurgerViewViewModelTests.swift` — 6 unit tests covering filter logic

## Also fixed (pre-existing SwiftLint violations uncovered during build)
- `Sources/Classic/AppDelegate/AppCoordinator.swift:65` — trailing space
- `Sources/Classic/Classes/Deep Links/DeepLinkResponseProcessor.swift:14` — blank line at start of scope

## Verified
- Build succeeded
- Simulator verified with AXe: Burger View appears in More menu, tapping navigates to screen, logged cheeseburger entry appears in list
- Build #70984 triggered on Bitrise workflow `TestFlightAndS3` for branch `cks/POW-1777`
