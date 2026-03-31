Think very deeply about all of this. Take your time. This is a critical architectural decision that will define how an entire company builds software for the next decade.

We are designing a next-generation mobile app platform built 100% with AI-assisted development. This is a greenfield architecture — we are NOT refactoring the existing codebase. We are designing from scratch with specific constraints.

VISION:
A single platform codebase that can be re-skinned and configured to produce multiple consumer apps. The CTO's directive:

"MFP (MyFitnessPal), CalAI, Yazio, Shotsy, and Flo are all apps on the same platform with different features turned on/off."

These are real health & wellness apps:
- MFP: calorie/macro tracking, food logging, exercise tracking, recipes
- CalAI: AI-powered calorie estimation from food photos
- Yazio: nutrition tracking, meal plans, fasting tracker
- Shotsy: (photo-based food tracking)
- Flo: period/fertility tracking, health insights, pregnancy mode

CORE ARCHITECTURAL CONSTRAINTS:

1. **Plugin Architecture**: Every customer-facing feature is a self-contained plug-in module. A feature gets developed independently and "plugged in" to the platform when complete. Features can be enabled/disabled per app brand. A feature plug-in must be buildable, testable, and deployable in isolation.

2. **Platform Abstraction Layer**: Each company/brand may have its own:
   - Persistence layer (CoreData, Realm, SQLite, CloudKit, server-synced)
   - Authorization / authentication (OAuth, proprietary, Apple Sign-In, social login)
   - Network services (REST APIs, GraphQL, different backend architectures)
   - Analytics (Amplitude, Mixpanel, Firebase, proprietary)
   - Push notifications
   - In-app purchases / subscription management
   The platform must abstract all of these behind interfaces that plug-ins code against.

3. **100% AI-Friendly**: The architecture must be designed so that AI agents (Claude, GPT, Gemini) can:
   - Read and understand any feature module without needing to understand the whole app
   - Write new feature modules from a spec without touching platform code
   - Write and run unit tests for any module in isolation
   - Refactor modules without breaking other modules
   - Understand the boundaries of what they can and cannot change
   This means: clear module boundaries, explicit contracts, no hidden coupling, consistent patterns, comprehensive type safety.

4. **iOS Only (for now)**: The platform targets iOS only at this stage. Swift and SwiftUI. No Android, no cross-platform, no Kotlin Multiplatform. Design the architecture so Android could be added later, but do not design for it now.

QUESTIONS TO ANSWER:

1. **Plugin Module Architecture**: What should a feature plug-in look like structurally? What files/interfaces must it implement? How does it register itself with the platform? How does the platform discover and load plug-ins? Consider: Swift Package Manager modules vs framework-based approaches. What are the trade-offs?

2. **Platform Abstraction Interfaces**: Design the core protocol/interface layer that plug-ins code against. What abstractions are needed for persistence, auth, networking, analytics, navigation, and theming? How do you avoid leaky abstractions while keeping the API surface small enough for AI to learn?

3. **AI-Friendly Code Patterns**: What specific patterns make code maximally readable and writable by AI? Consider: naming conventions, file organization, documentation requirements, type annotations, error handling patterns, dependency injection style. What anti-patterns must we avoid?

4. **Feature Isolation & Testing**: How do you ensure a plug-in can be built and tested without the full app? Mock platform services? Dependency injection? What does the test harness look like? How do you prevent integration failures when plug-ins are assembled?

5. **Multi-Brand Configuration**: How does the platform decide which features are enabled for MFP vs CalAI vs Flo? Runtime configuration? Build-time configuration? Feature flags? How does theming/branding work (colors, fonts, assets, strings)? How do you handle features that need brand-specific behavior?

6. **Navigation & Composition**: How do independently-developed plug-ins compose into a coherent app? How does navigation work across plug-in boundaries? Deep linking? Tab bar configuration per brand? How do plug-ins communicate when they need to (e.g., food log feature needs data from the nutrition database feature)?

7. **Data Model & Persistence**: If each brand has a different backend, how do plug-ins define their data needs without coupling to a specific persistence implementation? Repository pattern? What about offline-first vs server-first strategies per brand?

8. **Build System & CI/CD**: How do you build 5 different apps from one codebase? Xcode schemes/targets? How does CI test individual plug-ins vs the assembled app? How do you prevent one plug-in's failure from blocking another's deployment?

9. **AI Development Workflow**: How would an AI agent receive a feature spec and produce a complete, tested, plug-in module? What information does it need? What guardrails prevent it from breaking platform contracts? How do you validate AI-generated code before integration?

10. **Greenfield Bootstrap**: This is 100% from scratch — there is no legacy codebase to migrate from. What is the minimum viable platform that lets us start plugging in AI-generated features on day one? What do you build first? What's the "hello world" that proves the plugin architecture works end to end?

DELIVERABLES (in this order of priority):

1. **A recommended architecture with diagrams (describe in Mermaid syntax).** This is the MOST IMPORTANT deliverable. Show the full platform structure, plugin boundaries, service abstractions, and how the pieces connect.
2. **A clear, numbered phased rollout plan.** Define every phase with: name, goal, duration estimate, inputs, outputs, and exit criteria. All other analysis in this document should reference these phases by number. Do not reference "Phase 1" or "Phase 2" anywhere without first defining what they are.
3. A concrete example: what would the "Food Logging" feature plug-in look like? Show the file structure, interfaces, and how it wires into the platform.
4. A comparison of at least 3 architectural approaches (with trade-offs)
5. Specific recommendations for AI-friendliness — what makes code easy vs hard for AI to work with
6. Risk assessment: what could go wrong and how to mitigate
