import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

/** Joins class names, letting a later one override an earlier one that sets the same thing. */
export const cn = (...inputs: ReadonlyArray<ClassValue>) => twMerge(clsx(inputs))
