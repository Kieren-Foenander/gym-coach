import { Clock, Context, Effect, Layer, Scheduler, Schema } from "effect"
import { McpProtocol, McpServer, Tool, Toolkit } from "effect/ai"
import { HttpRouter, HttpServer } from "effect/http"
import { SqlClient } from "effect/sql"
import type { SqlError } from "effect/sql/SqlError"
import { DELOAD_FACTOR, MISSES_BEFORE_DELOAD } from "~/domain/progression"
import { ExercisePrescription, Id, PlanExercisePatch, PlanInput, ProfilePatch, SetInput } from "~/domain/schema"
import { Invalid, type DomainError } from "./errors"
import * as Repo from "./repo"
import { CurrentUser, type User } from "./repo"
import { DbLive } from "./runtime"

const INSTRUCTIONS = `This server is the user's gym training log. You are acting as their strength coach.

Start with get_overview: it returns their profile, the active plan (with the ids other tools need), recent workouts, and recent weight changes.

How the app works:
- A plan has days; each day lists exercises with sets, a rep range, a target weight, a weight increment and a rest time.
- The user logs sets in the app on their phone. All weights are in the unit given in the profile.
- When a workout is finished the app applies its own rule to every exercise with autoProgress on: all prescribed sets at the top of the rep range adds one increment; ${MISSES_BEFORE_DELOAD} sessions in a row where half or more of the sets miss the bottom of the range drops the weight ${Math.round((1 - DELOAD_FACTOR) * 100)}%. A null target weight means "find it in the first session".
- Your changes sit on top of that rule. Use update_plan_exercise for targeted changes and always give a short reason: the user sees it in the app next to the change.
- create_plan replaces the active plan (the old one is archived). Ask before replacing a plan the user is in the middle of.
- Use add_coach_note for a short message the user should see on the app's home screen, such as the focus for the coming week.
- Base advice on the logged data. If there is little history, say so and ask about goals, schedule, equipment and injuries, then save what you learn with update_profile.`

const Failure = Schema.Struct({ error: Schema.String })

const dependencies: [typeof CurrentUser] = [CurrentUser]
const options = { failure: Failure, failureMode: "return" as const, dependencies }

const describe = <S extends Schema.Top>(schema: S, description: string) => schema.annotate({ description })

const GetOverview = Tool.make("get_overview", {
  description:
    "Profile, active plan with ids, the next planned day, recent workouts, coach notes and recent weight changes. Call this first.",
  success: Schema.Unknown,
  ...options,
}).annotate(Tool.Readonly, true)

const GetTrainingHistory = Tool.make("get_training_history", {
  description: "Finished workouts with every logged set (weight, reps, RPE), newest first.",
  parameters: Schema.Struct({
    days: Schema.optional(describe(Schema.Int, "How many days back to look. Default 30.")),
    exercise: Schema.optional(describe(Schema.String, "Only this exercise, by exact name.")),
    limit: Schema.optional(describe(Schema.Int, "Most workouts to return. Default 20, at most 60.")),
  }),
  success: Schema.Unknown,
  ...options,
}).annotate(Tool.Readonly, true)

const GetExerciseProgress = Tool.make("get_exercise_progress", {
  description:
    "Per-session trend for one exercise: top set, estimated one-rep max (Epley), volume. Oldest first.",
  parameters: Schema.Struct({
    exercise: describe(Schema.String, "Exercise name, as it appears in the plan or history."),
    sessions: Schema.optional(describe(Schema.Int, "Most sessions to return. Default 20.")),
  }),
  success: Schema.Unknown,
  ...options,
}).annotate(Tool.Readonly, true)

const ListExercises = Tool.make("list_exercises", {
  description: "Every exercise the user has in a plan or has logged, with when it was last performed.",
  success: Schema.Unknown,
  ...options,
}).annotate(Tool.Readonly, true)

const CreatePlan = Tool.make("create_plan", {
  description:
    "Create a training plan and make it the active one. The current active plan is archived. Leave targetWeight out (or null) when there is no data to base it on.",
  parameters: PlanInput,
  success: Schema.Unknown,
  ...options,
}).annotate(Tool.Destructive, true)

const UpdatePlanExercise = Tool.make("update_plan_exercise", {
  description:
    "Change the prescription for one exercise in the active plan: sets, rep range, target weight, increment, rest, notes, or whether the app auto-progresses it. Only the fields given are changed.",
  parameters: Schema.Struct({
    planExerciseId: describe(Id, "The plan exercise id from get_overview."),
    changes: PlanExercisePatch,
    reason: describe(Schema.String, "One sentence the user will see explaining the change."),
  }),
  success: Schema.Unknown,
  ...options,
}).annotate(Tool.Destructive, false)

const AddPlanExercise = Tool.make("add_plan_exercise", {
  description: "Add an exercise to the end of a day in the active plan.",
  parameters: Schema.Struct({
    planDayId: describe(Id, "The plan day id from get_overview."),
    exercise: ExercisePrescription,
  }),
  success: Schema.Unknown,
  ...options,
}).annotate(Tool.Destructive, false)

const RemovePlanExercise = Tool.make("remove_plan_exercise", {
  description: "Remove an exercise from the active plan. Logged history for it is kept.",
  parameters: Schema.Struct({ planExerciseId: Id }),
  success: Schema.Unknown,
  ...options,
}).annotate(Tool.Destructive, true)

const UpdateProfile = Tool.make("update_profile", {
  description:
    "Save what you learn about the user: goal, and training context such as schedule, equipment, injuries and preferences. These replace the stored text, so include what should be kept.",
  parameters: ProfilePatch,
  success: Schema.Unknown,
  ...options,
}).annotate(Tool.Destructive, false)

const AddCoachNote = Tool.make("add_coach_note", {
  description: "Leave a short note that the user sees on the app's home screen.",
  parameters: Schema.Struct({ note: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1000)) }),
  success: Schema.Unknown,
  ...options,
}).annotate(Tool.Destructive, false)

const LogWorkout = Tool.make("log_workout", {
  description:
    "Record a workout that already happened and was not logged in the app, for example one the user describes in chat. It does not trigger the app's progression rule.",
  parameters: Schema.Struct({
    name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80)),
    date: Schema.optional(describe(Schema.String, "ISO 8601 date or date-time. Defaults to now.")),
    notes: Schema.optional(Schema.String.check(Schema.isMaxLength(1000))),
    exercises: Schema.Array(
      Schema.Struct({
        exercise: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80)),
        sets: Schema.Array(SetInput),
      }),
    ),
  }),
  success: Schema.Unknown,
  ...options,
}).annotate(Tool.Destructive, false)

export const GymToolkit = Toolkit.make(
  GetOverview,
  GetTrainingHistory,
  GetExerciseProgress,
  ListExercises,
  CreatePlan,
  UpdatePlanExercise,
  AddPlanExercise,
  RemovePlanExercise,
  UpdateProfile,
  AddCoachNote,
  LogWorkout,
)

const DAY_MS = 86_400_000

const clamp = (value: number | undefined, fallback: number, max: number) =>
  Math.min(Math.max(value ?? fallback, 1), max)

const profileOf = (user: User) => ({
  name: user.displayName,
  unit: user.unit,
  goal: user.goal,
  trainingContext: user.trainingContext,
})

export const GymHandlers = GymToolkit.toLayer(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    /** Runs a repository effect and turns its failures into a message the model can read and act on. */
    const run = <A>(effect: Effect.Effect<A, DomainError | SqlError, SqlClient.SqlClient | CurrentUser>) =>
      effect.pipe(
        Effect.provideService(SqlClient.SqlClient, sql),
        Effect.catchTag("SqlError", (error) =>
          Effect.logError(error).pipe(
            Effect.andThen(Effect.fail(new Invalid({ reason: "The database request failed" }))),
          ),
        ),
        Effect.mapError((error) => ({ error: error.message })),
      )

    return {
      get_overview: () =>
        run(
          Effect.gen(function* () {
            const user = yield* CurrentUser
            const today = yield* Repo.getToday()

            return {
              today: new Date(yield* Clock.currentTimeMillis).toISOString(),
              profile: profileOf(user),
              plan: today.plan,
              nextPlanDayId: today.nextDayId,
              workoutInProgress: today.activeWorkout !== null,
              recentWorkouts: today.recentWorkouts.map((workout) => ({
                id: workout.id,
                name: workout.name,
                date: new Date(workout.startedAt).toISOString(),
                sets: workout.setCount,
                volume: workout.volume,
              })),
              coachNotes: today.notes.map((note) => ({ note: note.body, date: new Date(note.createdAt).toISOString() })),
              recentWeightChanges: today.adjustments.map((adjustment) => ({
                exercise: adjustment.exerciseName,
                by: adjustment.source,
                from: adjustment.oldWeight,
                to: adjustment.newWeight,
                reason: adjustment.reason,
                date: new Date(adjustment.createdAt).toISOString(),
              })),
            }
          }),
        ),
      get_training_history: ({ days, exercise, limit }) =>
        run(
          Effect.gen(function* () {
            const since = (yield* Clock.currentTimeMillis) - clamp(days, 30, 3650) * DAY_MS
            const workouts = yield* Repo.getHistory({ since, exercise, limit: clamp(limit, 20, 60) })

            return { unit: (yield* CurrentUser).unit, workouts }
          }),
        ),
      get_exercise_progress: ({ exercise, sessions }) =>
        run(
          Effect.gen(function* () {
            const progress = yield* Repo.getExerciseProgress({ name: exercise }, clamp(sessions, 20, 100))

            return {
              exercise: progress.exercise.name,
              unit: (yield* CurrentUser).unit,
              sessions: progress.points.map((point) => ({
                date: new Date(point.date).toISOString(),
                topWeight: point.topWeight,
                topReps: point.topReps,
                estimatedOneRepMax: point.estimatedOneRepMax,
                volume: point.volume,
                sets: point.sets,
              })),
            }
          }),
        ),
      list_exercises: () =>
        run(
          Effect.map(Repo.listExercises(), (exercises) => ({
            exercises: exercises.map((exercise) => ({
              name: exercise.name,
              muscleGroup: exercise.muscleGroup,
              lastPerformed: exercise.lastPerformedAt ? new Date(exercise.lastPerformedAt).toISOString() : null,
            })),
          })),
        ),
      create_plan: (input) => run(Effect.map(Repo.createPlan(input, "ai"), (plan) => ({ plan }))),
      update_plan_exercise: ({ planExerciseId, changes, reason }) =>
        run(Effect.map(Repo.updatePlanExercise(planExerciseId, changes, "ai", reason), (planExercise) => ({ planExercise }))),
      add_plan_exercise: ({ planDayId, exercise }) =>
        run(Effect.map(Repo.addPlanExercise(planDayId, exercise), (planExercise) => ({ planExercise }))),
      remove_plan_exercise: ({ planExerciseId }) =>
        run(Effect.map(Repo.removePlanExercise(planExerciseId), (removed) => ({ removed: removed.exerciseName }))),
      update_profile: (patch) => run(Effect.map(Repo.updateProfile(patch), (user) => ({ profile: profileOf(user) }))),
      add_coach_note: ({ note }) => run(Effect.as(Repo.addCoachNote(note), { saved: true })),
      log_workout: (input) => run(Effect.map(Repo.logPastWorkout(input), (workoutId) => ({ workoutId }))),
    }
  }),
)

export const MCP_PATH = "/mcp"

const McpLive = McpServer.layerHttp({
  name: "Gym",
  version: "1.0.0",
  instructions: INSTRUCTIONS,
  path: MCP_PATH,
  // Newest first. The 2026 revision has no sessions; the older ones are kept for clients still using them.
  protocols: [McpProtocol.v2026_07_28, McpProtocol.v2025_11_25, McpProtocol.v2025_06_18, McpProtocol.v2025_03_26],
  registrations: McpServer.toolkit(GymToolkit).pipe(Layer.provide(GymHandlers), Layer.provide(DbLive)),
})

// The session-based revisions share one server fiber across requests. On Workers that needs the
// synchronous scheduler (see HttpRouter.toWebHandler).
const SyncScheduler = Layer.succeed(Scheduler.Scheduler, new Scheduler.MixedScheduler("sync"))

const app = HttpRouter.toWebHandler(
  McpLive.pipe(Layer.provide(HttpServer.layerServices), Layer.provideMerge(SyncScheduler)),
  { disableLogger: true },
)

/**
 * Older MCP revisions keep a session in the server's memory. A Worker isolate
 * can be replaced at any time, and the next request may land on a different
 * one, so a session id the client holds can be unknown here. The tools are
 * stateless, so instead of failing we open a fresh session on this isolate
 * and replay the request under it.
 */
const liveSessions = new Map<string, string>()

const post = (request: Request, body: string, context: Context.Context<CurrentUser>, sessionId: string | null) => {
  const headers = new Headers(request.headers)

  if (sessionId) headers.set("mcp-session-id", sessionId)
  else headers.delete("mcp-session-id")

  return app.handler(new Request(request.url, { method: "POST", headers, body }), context)
}

const openSession = async (request: Request, context: Context.Context<CurrentUser>, protocolVersion: string) => {
  const headers = new Headers(request.headers)
  headers.delete("mcp-session-id")
  headers.delete("mcp-protocol-version")
  headers.set("content-type", "application/json")

  const send = (body: string) => app.handler(new Request(request.url, { method: "POST", headers, body }), context)

  const initialized = await send(
    JSON.stringify({
      jsonrpc: "2.0",
      id: "session-recovery",
      method: "initialize",
      params: { protocolVersion, capabilities: {}, clientInfo: { name: "session-recovery", version: "1.0.0" } },
    }),
  )

  const sessionId = initialized.headers.get("mcp-session-id")
  await initialized.body?.cancel()

  if (!sessionId) return null
  headers.set("mcp-session-id", sessionId)
  headers.set("mcp-protocol-version", protocolVersion)
  const acknowledged = await send(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }))
  await acknowledged.body?.cancel()

  return sessionId
}

const sessionWasLost = async (response: Response, hadSession: boolean) => {
  if (response.status === 404) return hadSession

  if (response.status !== 400 || hadSession) return false

  return (await response.clone().text()).includes("MCP-Session-Id header is required")
}

export const handleMcpRequest = async (request: Request, user: User): Promise<Response> => {
  const context = Context.make(CurrentUser, user)

  if (request.method !== "POST") return app.handler(request, context)

  const body = await request.text()
  const clientSession = request.headers.get("mcp-session-id")
  const protocolVersion = request.headers.get("mcp-protocol-version") ?? "2025-03-26"
  const key = `${user.id}:${clientSession ?? ""}:${protocolVersion}`
  const sessionId = liveSessions.get(key) ?? clientSession

  const response = await post(request, body, context, sessionId)

  if (!(await sessionWasLost(response, sessionId !== null))) return response

  const recovered = await openSession(request, context, protocolVersion)

  if (!recovered) return response
  await response.body?.cancel()

  if (liveSessions.size > 500) liveSessions.clear()
  liveSessions.set(key, recovered)

  return post(request, body, context, recovered)
}
