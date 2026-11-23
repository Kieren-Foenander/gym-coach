import { createBottomTabNavigator, type BottomTabBarProps } from "@react-navigation/bottom-tabs"
import { DarkTheme, NavigationContainer, type NavigatorScreenParams } from "@react-navigation/native"
import { createNativeStackNavigator, type NativeStackScreenProps } from "@react-navigation/native-stack"
import { BlurView } from "expo-blur"
import { useEffect } from "react"
import { Pressable, StyleSheet, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import type { Muscle } from "~/domain/catalog"
import { TABS, testIds } from "~/domain/test-ids"
import { rememberUser, useSession } from "@/api/session"
import { TabIcon, type TabName } from "@/components/icons"
import { Text } from "@/components/ui"
import { useCall } from "@/data/calls"
import { SignInScreen } from "@/features/auth/SignInScreen"
import { SignUpScreen } from "@/features/auth/SignUpScreen"
import { CalendarScreen } from "@/features/calendar/CalendarScreen"
import { AddToPlanSheet } from "@/features/exercises/AddToPlanSheet"
import { LibraryExerciseScreen, OwnExerciseScreen } from "@/features/exercises/ExerciseDetailScreen"
import { ExercisesScreen } from "@/features/exercises/ExercisesScreen"
import { MuscleGroupScreen } from "@/features/exercises/MuscleGroupScreen"
import { NutritionScreen } from "@/features/nutrition/NutritionScreen"
import { HistoryScreen } from "@/features/history/HistoryScreen"
import { AddPlanDaySheet, AddPlanExerciseSheet, EditPlanExerciseSheet, TemplatesSheet } from "@/features/plan/PlanSheets"
import { PlanScreen } from "@/features/plan/PlanScreen"
import { SettingsScreen } from "@/features/settings/SettingsScreen"
import { TodayScreen } from "@/features/today/TodayScreen"
import { LoadingGuideSheet } from "@/features/workout/LoadingGuideSheet"
import { AddWorkoutExerciseSheet, ExerciseNoteSheet, SwapExerciseSheet } from "@/features/workout/WorkoutSheets"
import { WorkoutScreen } from "@/features/workout/WorkoutScreen"
import { UserContext } from "@/features/user"
import { colors } from "@/theme"

/**
 * Every screen in the app and what it needs to be opened. Pages push onto one stack over
 * the tabs, so Back and the swipe from the edge always lead where you came from. Sheets
 * are presented over whatever is showing and close with a swipe down.
 */

export type TabParams = { readonly [K in TabName]: undefined }

export type AppStackParams = {
  readonly Tabs: NavigatorScreenParams<TabParams> | undefined
  readonly Workout: { readonly workoutId: number }
  readonly Calendar: undefined
  readonly Nutrition: undefined
  readonly MuscleGroup: { readonly muscle: Muscle }
  readonly LibraryExercise: { readonly slug: string }
  readonly OwnExercise: { readonly exerciseId: number }
  // sheets
  readonly EditPlanExercise: { readonly planExerciseId: number }
  readonly AddPlanExercise: { readonly planDayId: number }
  readonly AddPlanDay: undefined
  readonly Templates: undefined
  readonly AddToPlan: { readonly name: string }
  readonly AddWorkoutExercise: { readonly workoutId: number }
  readonly SwapExercise: { readonly workoutId: number; readonly planExerciseId: number }
  readonly LoadingGuide: { readonly exerciseName: string; readonly weight: number }
  readonly ExerciseNote: { readonly workoutId: number; readonly exerciseId: number }
}

export type AuthStackParams = {
  readonly SignIn: undefined
  readonly SignUp: undefined
}

export type AppScreenProps<K extends keyof AppStackParams> = NativeStackScreenProps<AppStackParams, K>

export type AuthScreenProps<K extends keyof AuthStackParams> = NativeStackScreenProps<AuthStackParams, K>

declare global {
  namespace ReactNavigation {
    interface RootParamList extends AppStackParams {}
  }
}

const AppStack = createNativeStackNavigator<AppStackParams>()
const AuthStack = createNativeStackNavigator<AuthStackParams>()
const Tabs = createBottomTabNavigator<TabParams>()

const TAB_NAMES: ReadonlyArray<TabName> = ["Today", "Plan", "Exercises", "History", "Settings"]

/** The floating pill of tabs at the bottom of the screen. */
function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets()

  return (
    <View pointerEvents="box-none" className="absolute inset-x-0 px-4" style={{ bottom: Math.max(insets.bottom, 12) }}>
      <View className="w-full max-w-sm self-center overflow-hidden rounded-full border border-white/10">
        <BlurView intensity={50} tint="dark" style={StyleSheet.absoluteFill} />
        <View accessibilityRole="tablist" className="flex-row gap-0.5 bg-surface/85 p-1.5">
          {state.routes.map((route, index) => {
            const focused = state.index === index
            const tab = TAB_NAMES[index] ?? "Today"

            const press = () => {
              const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true })

              if (!focused && !event.defaultPrevented) navigation.navigate(route.name)
            }

            return (
              <Pressable
                key={route.key}
                testID={testIds.nav.tab(TABS[index] ?? "today")}
                accessibilityRole="tab"
                accessibilityLabel={tab}
                accessibilityState={{ selected: focused }}
                onPress={press}
                className={`min-h-12 flex-1 items-center justify-center gap-0.5 rounded-full ${focused ? "bg-accent/12" : ""}`}
              >
                <TabIcon tab={tab} size={20} color={focused ? colors.accent : colors.faint} />
                <Text className={`text-[11px] font-semibold ${focused ? "text-accent" : "text-faint"}`}>{tab}</Text>
              </Pressable>
            )
          })}
        </View>
      </View>
    </View>
  )
}

function TabScreens() {
  return (
    <Tabs.Navigator tabBar={(props) => <TabBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="Today" component={TodayScreen} />
      <Tabs.Screen name="Plan" component={PlanScreen} />
      <Tabs.Screen name="Exercises" component={ExercisesScreen} />
      <Tabs.Screen name="History" component={HistoryScreen} />
      <Tabs.Screen name="Settings" component={SettingsScreen} />
    </Tabs.Navigator>
  )
}

/** Keeps the saved profile in step with the server, which the AI coach can change too. */
function ProfileSync() {
  const { data } = useCall("getSession", {})

  useEffect(() => {
    if (data) rememberUser(data)
  }, [data])

  return null
}

const NAVIGATION_THEME = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colors.accent,
    background: colors.ink,
    card: colors.surface,
    text: colors.white,
    border: colors.line,
  },
}

const PAGE = { headerShown: false, contentStyle: { backgroundColor: colors.ink } } as const
const SHEET = { headerShown: false, presentation: "modal", contentStyle: { backgroundColor: colors.surface } } as const

export function Navigation() {
  const session = useSession()

  return (
    <NavigationContainer theme={NAVIGATION_THEME}>
      {session.status === "signedIn" ? (
        <UserContext value={session.user}>
          <ProfileSync />
          <AppStack.Navigator screenOptions={PAGE}>
            <AppStack.Screen name="Tabs" component={TabScreens} />
            {/* A workout is left with its own buttons, so a stray swipe cannot drop you out of it mid-set. */}
            <AppStack.Screen name="Workout" component={WorkoutScreen} options={{ gestureEnabled: false }} />
            <AppStack.Screen name="Calendar" component={CalendarScreen} />
            <AppStack.Screen name="Nutrition" component={NutritionScreen} />
            <AppStack.Screen name="MuscleGroup" component={MuscleGroupScreen} />
            <AppStack.Screen name="LibraryExercise" component={LibraryExerciseScreen} />
            <AppStack.Screen name="OwnExercise" component={OwnExerciseScreen} />
            <AppStack.Group screenOptions={SHEET}>
              <AppStack.Screen name="EditPlanExercise" component={EditPlanExerciseSheet} />
              <AppStack.Screen name="AddPlanExercise" component={AddPlanExerciseSheet} />
              <AppStack.Screen name="AddPlanDay" component={AddPlanDaySheet} />
              <AppStack.Screen name="Templates" component={TemplatesSheet} />
              <AppStack.Screen name="AddToPlan" component={AddToPlanSheet} />
              <AppStack.Screen name="AddWorkoutExercise" component={AddWorkoutExerciseSheet} />
              <AppStack.Screen name="SwapExercise" component={SwapExerciseSheet} />
              <AppStack.Screen name="LoadingGuide" component={LoadingGuideSheet} />
              <AppStack.Screen name="ExerciseNote" component={ExerciseNoteSheet} />
            </AppStack.Group>
          </AppStack.Navigator>
        </UserContext>
      ) : (
        <AuthStack.Navigator screenOptions={PAGE}>
          <AuthStack.Screen name="SignIn" component={SignInScreen} />
          <AuthStack.Screen name="SignUp" component={SignUpScreen} />
        </AuthStack.Navigator>
      )}
    </NavigationContainer>
  )
}
