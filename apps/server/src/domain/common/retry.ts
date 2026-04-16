export const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export const isRetryableErrorText = (message: string) => {
  const lower = message.toLowerCase()
  return (
    lower.includes("aborted") ||
    lower.includes("timeout") ||
    lower.includes("server overload") ||
    lower.includes("429")
  )
}

export const runWithRetry = async <T>(input: {
  attempts: number
  delayMs: number
  task: () => Promise<T>
  shouldRetry: (errorMessage: string) => boolean
}): Promise<T> => {
  const maxAttempts = Math.max(1, input.attempts)
  let lastError: Error | undefined

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await input.task()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      lastError = error instanceof Error ? error : new Error(message)
      const isLastAttempt = attempt >= maxAttempts - 1
      if (!isLastAttempt && input.shouldRetry(message)) {
        await wait(input.delayMs)
        continue
      }
      throw lastError
    }
  }

  throw lastError ?? new Error("retry exhausted")
}
