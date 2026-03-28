(function () {
  const testStateKey = "__TS_SIMPLE_LOGGER_BROWSER_TEST__"

  const setState = (partial) => {
    const current = globalThis[testStateKey]
    globalThis[testStateKey] = {
      kind: current?.kind ?? null,
      status: current?.status ?? "idle",
      error: current?.error ?? null,
      ...partial
    }
  }

  const createCrossRealmObject = () => {
    const frame = document.createElement("iframe")
    frame.style.display = "none"
    document.body.append(frame)

    const foreignWindow = frame.contentWindow
    if (!foreignWindow) {
      frame.remove()
      throw new Error("iframe contentWindow is unavailable")
    }

    const foreignObject = new foreignWindow.Object()
    return {
      foreignObject,
      cleanup: () => frame.remove()
    }
  }

  const requireFunction = (value, name) => {
    if (typeof value !== "function") {
      throw new TypeError(`missing browser test api: ${name}`)
    }
  }

  const runScenario = ({ kind, api }) => {
    setState({ kind, status: "running", error: null })

    try {
      requireFunction(api?.getLogger, "getLogger")
      requireFunction(api?.setDefaultConfig, "setDefaultConfig")
      requireFunction(api?.setLoggerConfig, "setLoggerConfig")
      requireFunction(api?.setLoggerLevel, "setLoggerLevel")
      requireFunction(api?.getDefaultConfig, "getDefaultConfig")
      requireFunction(api?.getLoggerOverrides, "getLoggerOverrides")
      requireFunction(api?.getLibraryDefaults, "getLibraryDefaults")

      const {
        getLogger,
        setDefaultConfig,
        setLoggerConfig,
        setLoggerLevel,
        getDefaultConfig,
        getLoggerOverrides,
        getLibraryDefaults
      } = api
      let tick = 0

      setDefaultConfig({
        level: "trace",
        prefixEnabled: true,
        prefixFormat: `[${kind}][%app-name][%loggerName] %logLevel: [%tick]`,
        placeholders: {
          "%app-name": `browser-${kind}`,
          "%tick": () => `${kind}-${++tick}`
        }
      })

      const logger = getLogger(`${kind}-demo`)
      const secondaryLogger = getLogger(`${kind}-network`)

      setLoggerConfig(`${kind}-network`, { level: "warn" })

      logger.trace(`${kind} trace`)
      logger.debug(`${kind} debug`)
      logger.info(`${kind} info`)
      secondaryLogger.info(`${kind} network info (hidden because level=warn)`)
      secondaryLogger.warn(`${kind} network warning`)
      secondaryLogger.error(`${kind} network error`, { status: 500 })

      setDefaultConfig({
        placeholders: {
          "%app-name": `merged-${kind}`,
          "%phase": "default-merge"
        },
        prefixFormat: `[${kind}-default-merge][%app-name][%phase][%tick][%loggerName] %logLevel:`
      })
      const defaultMergeLogger = getLogger(`${kind}-default-merge`)
      defaultMergeLogger.info(`${kind} default placeholder merge works`)
      setDefaultConfig({
        placeholders: {
          "%phase": null
        }
      })
      defaultMergeLogger.info(`${kind} default placeholder delete works`)
      setLoggerConfig(`${kind}-logger-merge`, {
        placeholders: {
          "%service": `service-${kind}`,
          "%phase": "warmup"
        },
        prefixFormat: `[${kind}-logger-merge][%service][%phase][%tick][%loggerName] %logLevel:`
      })
      setLoggerConfig(`${kind}-logger-merge`, {
        placeholders: {
          "%service": `service-${kind}-v2`
        }
      })
      const loggerMergeLogger = getLogger(`${kind}-logger-merge`)
      loggerMergeLogger.info(`${kind} logger placeholder merge works`)
      setLoggerConfig(`${kind}-logger-merge`, {
        placeholders: {
          "%service": null
        }
      })
      loggerMergeLogger.info(`${kind} logger placeholder delete works`)
      setDefaultConfig({
        level: "trace",
        prefixEnabled: true,
        prefixFormat: `[${kind}][%app-name][%loggerName] %logLevel: [%tick]`,
        placeholders: {
          "%app-name": `browser-${kind}`,
          "%tick": () => `${kind}-${++tick}`
        }
      })

      const edgeNoPrefix = getLogger(`${kind}-no-prefix`)
      setLoggerConfig(`${kind}-no-prefix`, { prefixEnabled: false })
      edgeNoPrefix.info(`${kind} edge no prefix`)

      const resolvedEmptyPrefix = getLogger(`${kind}-resolved-empty-prefix`)
      setLoggerConfig(`${kind}-resolved-empty-prefix`, {
        prefixEnabled: true,
        prefixFormat: "%empty",
        placeholders: { "%empty": "" }
      })
      resolvedEmptyPrefix.info(`${kind} resolved empty prefix`)

      const edgeOverride = getLogger(`${kind}-edge-override`)
      setLoggerLevel(`${kind}-edge-override`, "error")
      edgeOverride.warn(`${kind} edge hidden warn`)
      edgeOverride.error(`${kind} edge error`)

      const validationLogger = getLogger(`${kind}-validation`)
      setLoggerConfig(`${kind}-validation`, {
        prefixFormat: `[${kind}-validation][%app-name][%loggerName] %logLevel:`,
        placeholders: { "%app-name": kind }
      })

      try {
        setDefaultConfig({ prefixEnabled: `invalid_${kind}_prefix_enabled` })
      } catch (error) {
        logger.error(`caught invalid prefixEnabled: ${error.message}`)
      }

      try {
        setDefaultConfig(0)
      } catch (error) {
        logger.error(`caught invalid config object: ${error.message}`)
      }

      try {
        setLoggerConfig(`${kind}-validation`, false)
      } catch (error) {
        logger.error(`caught invalid logger config object: ${error.message}`)
      }

      try {
        setLoggerConfig(`${kind}-validation`, { prefixFormat: 123 })
      } catch (error) {
        logger.error(`caught invalid prefixFormat: ${error.message}`)
      }

      try {
        setDefaultConfig({ placeholders: [] })
      } catch (error) {
        logger.error(`caught invalid placeholders: ${error.message}`)
      }

      try {
        setDefaultConfig({ placeholders: new Map([["%app", "svc"]]) })
      } catch (error) {
        logger.error(`caught invalid placeholder container: ${error.message}`)
      }

      try {
        setLoggerConfig(`${kind}-validation`, { placeholders: { "%app.name": "svc" } })
      } catch (error) {
        logger.error(`caught invalid placeholder key: ${error.message}`)
      }

      try {
        setLoggerConfig(`${kind}-validation`, { placeholders: { "%loggerName": "svc" } })
      } catch (error) {
        logger.error(`caught reserved placeholder key: ${error.message}`)
      }

      try {
        setLoggerConfig(`${kind}-validation`, { placeholders: { "%bad": 123 } })
      } catch (error) {
        logger.error(`caught invalid placeholder value: ${error.message}`)
      }

      validationLogger.info(`${kind} validation still works`)

      setDefaultConfig({
        level: "error",
        prefixEnabled: false,
        prefixFormat: `[${kind}-default-reset][%app-name][%loggerName] %logLevel:`,
        placeholders: { "%app-name": `reset-${kind}` }
      })
      setDefaultConfig({
        level: null,
        prefixEnabled: null,
        prefixFormat: null,
        placeholders: null
      })
      const defaultResetLogger = getLogger(`${kind}-default-reset`)
      defaultResetLogger.info(`${kind} default reset works`)

      setDefaultConfig({
        level: "trace",
        prefixEnabled: true,
        prefixFormat: `[${kind}][%app-name][%loggerName] %logLevel: [%tick]`,
        placeholders: {
          "%app-name": `browser-${kind}`,
          "%tick": () => `${kind}-${++tick}`
        }
      })
      setLoggerConfig(`${kind}-validation`, {
        level: "error",
        prefixEnabled: false,
        prefixFormat: `[${kind}-validation-reset][%app-name][%loggerName] %logLevel:`,
        placeholders: {
          "%app-name": `override-${kind}`,
          "%phase": "logger-reset"
        }
      })
      setLoggerConfig(`${kind}-validation`, {
        level: null,
        prefixEnabled: null,
        prefixFormat: null,
        placeholders: null
      })
      validationLogger.info(`${kind} logger reset works`)

      const foreignLogger = getLogger(`${kind}-foreign-realm`)
      let cleanupForeignConfig = () => {}
      let cleanupForeignPlaceholders = () => {}

      try {
        const { foreignObject: foreignConfig, cleanup } = createCrossRealmObject()
        cleanupForeignConfig = cleanup

        const {
          foreignObject: foreignPlaceholders,
          cleanup: cleanupPlaceholders
        } = createCrossRealmObject()
        cleanupForeignPlaceholders = cleanupPlaceholders

        foreignConfig.prefixEnabled = true
        foreignConfig.prefixFormat = `[${kind}-foreign][%app][%loggerName] %logLevel:`
        foreignPlaceholders["%app"] = "iframe"
        foreignConfig.placeholders = foreignPlaceholders

        setLoggerConfig(`${kind}-foreign-realm`, foreignConfig)
        foreignLogger.info(`${kind} foreign realm still works`)
      } catch (error) {
        logger.error(`caught foreign realm config: ${error.message}`)
      } finally {
        cleanupForeignPlaceholders()
        cleanupForeignConfig()
      }

      try {
        setLoggerLevel(`${kind}-invalid`, `invalid_${kind}_level`)
      } catch (error) {
        logger.error(`caught invalid config: ${error.message}`)
      }

      setDefaultConfig({
        level: "info",
        prefixEnabled: true,
        prefixFormat: `[${kind}-default-snapshot][%app][%loggerName] %logLevel:`,
        placeholders: { "%app": `stable-default-${kind}` }
      })

      const existingDefaultSnapshotLogger = getLogger(`${kind}-default-snapshot-existing`)
      const defaultSnapshot = getDefaultConfig()
      defaultSnapshot.level = "error"
      defaultSnapshot.prefixEnabled = false
      defaultSnapshot.prefixFormat = `[${kind}-tampered-default][%app][%loggerName] %logLevel:`
      defaultSnapshot.placeholders["%app"] = `tampered-default-${kind}`

      existingDefaultSnapshotLogger.info(`${kind} default snapshot existing`)
      const newDefaultSnapshotLogger = getLogger(`${kind}-default-snapshot-new`)
      newDefaultSnapshotLogger.info(`${kind} default snapshot new`)

      const overrideInputPlaceholders = { "%app": `stable-override-${kind}` }
      setLoggerConfig(`${kind}-override-snapshot`, {
        prefixFormat: `[${kind}-override-snapshot][%app][%loggerName] %logLevel:`,
        placeholders: overrideInputPlaceholders
      })
      overrideInputPlaceholders["%app"] = `tampered-input-${kind}`

      const overrideSnapshotLogger = getLogger(`${kind}-override-snapshot`)
      overrideSnapshotLogger.info(`${kind} override snapshot input`)

      const overrideSnapshot = getLoggerOverrides(`${kind}-override-snapshot`)
      overrideSnapshot.prefixFormat = `[${kind}-tampered-override][%app][%loggerName] %logLevel:`
      overrideSnapshot.placeholders["%app"] = `tampered-override-${kind}`

      setDefaultConfig({ level: "info" })
      overrideSnapshotLogger.info(`${kind} override snapshot getter`)

      const libraryDefaults = getLibraryDefaults()
      libraryDefaults.level = "error"
      libraryDefaults.prefixEnabled = false
      libraryDefaults.prefixFormat = `[${kind}-tampered-library]`
      libraryDefaults.placeholders["%app"] = `tampered-library-${kind}`

      const libraryDefaultsAfter = getLibraryDefaults()
      console.info(
        `library defaults stable: ${libraryDefaultsAfter.level}|${libraryDefaultsAfter.prefixEnabled}|${libraryDefaultsAfter.prefixFormat}|${JSON.stringify(libraryDefaultsAfter.placeholders)}`
      )

      setState({ kind, status: "done", error: null })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setState({ kind, status: "error", error: message })
      console.error(`browser integration scenario failed for ${kind}: ${message}`)
    }
  }

  setState({ status: "idle", error: null })
  globalThis.TsSimpleLoggerBrowserTest = {
    runScenario,
    testStateKey
  }
})()
