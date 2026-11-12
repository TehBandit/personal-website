/* eslint-disable react-refresh/only-export-components */
import "./ScreenTimePost.css";

export const meta = {
  title: '“How much time do you need?” Debugging iOS Screen Time in Due or Die',
  desc: "The failed timers, false permission errors, and cross-process state bugs behind a seemingly simple app-blocking screen.",
  slug: "ios-screen-time-timed-access",
  date: "2026-11-11",
  tag: "Development",
};

function Code({ children }) {
  return <pre><code>{children}</code></pre>;
}

export default function ScreenTimePost() {
  return (
    <article className="screen-time-post" aria-label="Debugging timed app access on iOS">
      <p className="stp-lead">
        I wanted a screen that asked a fairly reasonable question before you opened a distracting app:
        how much time do you need? Pick a duration, use the app, and see the screen again when time runs out.
        Getting those three steps to work together was considerably less reasonable.
      </p>
      <p>
        This was for Due or Die, my task and accountability app. The reminder is supposed to interrupt
        an automatic trip into a blocklisted app while you still have things to do. It offers a small,
        deliberate allowance without turning every reminder into a strict punishment. The finished
        choices are <strong>1 minute</strong>, <strong>10 minutes</strong>, and <strong>Until tomorrow</strong>.
      </p>
      <p>
        Along the way, the screen appeared late, stayed over an app after I chose a time, failed to
        return when time expired, and insisted I needed to approve Screen Time while Settings showed
        that I already had. Reopening Due or Die sometimes seemed to fix things, which made debugging
        particularly misleading.
      </p>
      <p>
        The normal flow now works on my physical iPhone: choosing a duration opens the app on the first
        try, and the shield returns when the allowance expires. This is the account of what changed,
        including the approaches that looked correct in code and still failed on the phone.
      </p>

      <nav className="stp-contents" aria-label="In this article">
        <strong>In this article</strong>
        <ol>
          <li><a href="#system">The system behind the screen</a></li>
          <li><a href="#eligibility">When it should appear</a></li>
          <li><a href="#timers">Three timer approaches</a></li>
          <li><a href="#opening">Why choosing a time did not open the app</a></li>
          <li><a href="#authorization">Permission was enabled. Our check still failed.</a></li>
          <li><a href="#storage">The last failure was a save check</a></li>
          <li><a href="#verification">How I would debug this again</a></li>
        </ol>
      </nav>

      <h2 id="system">One screen, several processes</h2>
      <p>
        The app uses React Native and Expo, with a custom Swift module and native extensions for iOS
        enforcement. The screen over the distracting app is an Apple Screen Time <em>shield</em>.
        It is not a React screen that I can show over another app with a navigation call.
      </p>
      <div className="stp-table" role="region" aria-label="Responsibilities in the Screen Time flow" tabIndex={0}>
        <table>
          <thead><tr><th>Part</th><th>Responsibility in this implementation</th></tr></thead>
          <tbody>
            <tr><td>Main app / FamilyControls</td><td>Request individual authorization, save app selections, and publish task state.</td></tr>
            <tr><td>ShieldConfiguration extension</td><td>Read shared state and describe the system shield.</td></tr>
            <tr><td>ShieldAction extension</td><td>Handle a duration selection and attempt to grant access.</td></tr>
            <tr><td>DeviceActivityMonitor extension</td><td>Handle the native expiry callbacks and restore restrictions.</td></tr>
            <tr><td>ManagedSettings stores</td><td>Hold the restrictions requested by the reminder and required-lock systems.</td></tr>
            <tr><td>App Group storage</td><td>Share authorization receipts, selections, sessions, and other enforcement inputs.</td></tr>
          </tbody>
        </table>
      </div>
      <p>
        A successful action in one process does not mean another process has loaded the same state.
        A successful settings write does not prove the shield visibly changed. Those distinctions
        explain much of what follows.
      </p>

      <h2 id="eligibility">First, define when the interruption belongs there</h2>
      <p>
        My first timed-access implementation gated individually selected apps whenever the feature
        was enabled. The later implementation needed a more precise rule: show the ordinary reminder
        while unfinished tasks due today or overdue remain. Completed tasks, future tasks, and onboarding
        sample tasks should not keep it alive.
      </p>
      <p>
        I reused the task snapshot already shared with the widget instead of creating another task
        database for this screen. Native code evaluates dates and pending completion receipts when it
        reads that snapshot. That matters after midnight and when a task is completed through a native
        action before JavaScript has caught up.
      </p>
      <p>
        There are also two deliberately different kinds of restriction. An ordinary reminder permits
        more time. A required task, punishment, work, or focus lock does not. The onboarding demo is
        a third case: it lasts ten minutes and offers the duration choices even with no ordinary tasks,
        but it must never override a real required lock.
      </p>
      <div className="stp-table" role="region" aria-label="Which shield should appear" tabIndex={0}>
        <table>
          <thead><tr><th>State, in priority order</th><th>Expected result</th></tr></thead>
          <tbody>
            <tr><td>Required lock active</td><td>Strict shield. No timed escape.</td></tr>
            <tr><td>Demo active, no required lock</td><td>Allow a valid per-app pass; otherwise offer the three choices.</td></tr>
            <tr><td>Relevant unfinished tasks, reminder enabled</td><td>Allow a valid pass; otherwise ask for a duration.</td></tr>
            <tr><td>Pass expires and reminder still applies</td><td>Show the time-up shield and allow another explicit choice.</td></tr>
            <tr><td>No relevant tasks, demo, or required lock</td><td>Clear the ordinary reminder and retire its passes.</td></tr>
          </tbody>
        </table>
      </div>
      <p>
        I also stopped using the presence of a restriction in a ManagedSettings store as the definition
        of a live lock. That is enforcement output; it can outlast the condition that created it. The
        shared lock policy now reads the actual persisted deadlines, work windows, focus state, and
        completion evidence. It can retire an expired store without treating an active punishment as
        permission to offer extra time.
      </p>
      <p>
        Shield rendering became read-only too. The early version called reconciliation while deciding
        what to display, which could acquire a writable App Group lock, save state, and touch monitor
        APIs. The current configuration extension only reads and classifies. Writes belong in the host,
        action handler, and monitor paths. Rendering the question should not itself change its answer.
      </p>

      <h2 id="timers">Attempt one: count active usage</h2>
      <p>
        The first committed version, on November 5, offered 2, 5, or 10 minutes of <em>active use</em>.
        It registered an app-specific <code>DeviceActivityEvent</code> with a usage threshold inside a
        monitoring window ending at midnight. Leaving the app was intended to preserve the remainder.
        The threshold and the monitoring window were separate concepts.
      </p>
      <Code>{`// Original approach: a usage allowance inside a longer schedule.
let event = DeviceActivityEvent(
  applications: [application],
  threshold: DateComponents(minute: minutes),
  includesPastActivity: false
)

try center.startMonitoring(activity, during: schedule, events: [eventName: event])`}</Code>
      <p>
        Apple's monitoring interval has a <a href="https://developer.apple.com/documentation/deviceactivity/deviceactivitycenter/monitoringerror/intervaltooshort">fifteen-minute minimum</a>.
        The original code used at least sixteen minutes, backdating the start near midnight and retrying
        with a longer window if necessary. It preserved the selected usage threshold rather than
        silently turning a two-minute allowance into a fifteen-minute allowance.
      </p>
      <p>
        That approach encoded the original product behavior, but the behavior changed. I wanted an
        elapsed-time break: choose one minute and the deadline remains one minute away even if you
        switch apps or lock the phone. The choices became one minute, ten minutes, or the next local
        midnight. This was a change in semantics, not just a different way to implement the same timer.
        Old usage-based passes are retired rather than reinterpreted as elapsed passes.
      </p>
      <p>
        One useful warning from reviewing this history: an older internal document still described
        the active-use version after the code had moved on. Check the implementation and migration
        policy before borrowing a timer design from your own documentation.
      </p>

      <h2>Attempt two: make the end warning expire the pass</h2>
      <p>
        A one-minute elapsed deadline still cannot be represented as a one-minute DeviceActivity
        interval. An intermediate recovery design used a longer, already-ongoing interval: its end
        warning targeted the selected expiry, and the interval end targeted five seconds later.
        Short allowances required backdating the interval start to meet the minimum length.
      </p>
      <p>
        The arithmetic produced the requested 60/65-second targets. The registration shape was a
        problem. Apple documents that an extension can begin receiving callbacks immediately if
        <a href="https://developer.apple.com/documentation/deviceactivity/deviceactivitycenter/startmonitoring(_:during:events:)"> startMonitoring registers an ongoing interval</a>.
        Our registration and callback paths could both reach shared-state and shield operations while
        the original action was still waiting for registration to finish.
      </p>
      <p>
        This was a concrete reentrancy risk, but I cannot claim it was the captured cause of that
        particular device failure: we did not have the necessary grant trace. What we did know was
        that selecting any of the three choices on the installed build left the shield in place,
        without a useful error. Correct deadline math had not established a working opening flow.
      </p>

      <h2>Attempt three: schedule the interval to start at expiry</h2>
      <p>
        The current design moves the whole monitoring interval into the future. The selected deadline
        is the interval's <em>start</em>. The interval lasts sixteen minutes. Its end warning is
        fifteen minutes and fifty-five seconds before its end, placing that warning five seconds after
        the selected deadline. Apple's <a href="https://developer.apple.com/documentation/deviceactivity/deviceactivityschedule/warningtime">warningTime documentation</a> explains
        how warnings are positioned relative to the boundaries.
      </p>
      <Code>{`// Simplified from the production deadline policy.
let intervalStart = expiry
let intervalEnd = expiry.addingTimeInterval(16 * 60)
let warning = DateComponents(minute: 15, second: 55)

let schedule = DeviceActivitySchedule(
  intervalStart: utcComponents(intervalStart),
  intervalEnd: utcComponents(intervalEnd),
  repeats: false,
  warningTime: warning
)

try center.startMonitoring(activity, during: schedule)`}</Code>
      <p>
        Here <code>utcComponents</code> stands for our helper that supplies a full Gregorian date,
        seconds, calendar, and UTC time zone. This is an excerpt, not a complete grant implementation.
        No usage-threshold event is registered for these elapsed passes. The start-warning callback
        is not used to expire them.
      </p>
      <figure className="stp-timeline">
        <figcaption>A one-minute allowance prepared at 12:00:00</figcaption>
        <ol>
          <li><time>12:00:00</time><span>Save pending pass, register future monitor, then unshield.</span></li>
          <li><time>12:01:00</time><span><code>intervalDidStart</code>: primary expiry.</span></li>
          <li><time>12:01:05</time><span><code>intervalWillEndWarning</code>: recovery attempt.</span></li>
          <li><time>12:17:00</time><span><code>intervalDidEnd</code>: later fallback.</span></li>
        </ol>
      </figure>
      <p>
        This meets the minimum interval without registering inside the main interval. The callbacks
        reconcile the stored deadline rather than granting time. Unique session IDs prevent a delayed
        callback for an old pass from ending a newer one. Callbacks received during pending registration
        are guarded against reentering shield writes, while abandoned pending records can still expire.
      </p>
      <p>
        Finite deadlines are rounded up to the next second, adding less than a second at preparation.
        Until tomorrow is calculated with the local calendar's next day boundary, then encoded as an
        absolute instant. It does not mean “24 hours from now,” especially around daylight-saving changes.
      </p>
      <p>
        These are requested callback times. My confirmation that normal expiry works on the phone does
        not prove iOS always delivers either callback at an exact second, or that the forced recovery
        case has passed. The five-second spacing belongs to our schedule; actual delivery belongs to iOS.
      </p>

      <h2 id="opening">“Open app” meant two different things</h2>
      <p>
        Revealing the distracting app and opening Due or Die are separate operations. After a successful
        timed grant, the target app is already underneath the shield. Our job is to remove its reminder
        restriction and complete the action with <code>.none</code>. That response means
        <a href="https://developer.apple.com/documentation/managedsettings/shieldactionresponse/none"> no additional system action is required</a>;
        it does not remove a restriction by itself.
      </p>
      <p>
        A strict lock's navigation button instead takes the user back to Due or Die. Apple's
        <a href="https://developer.apple.com/documentation/managedsettings/shieldactionresponse/openparentalcontrolsapp"> .openParentalControlsApp response</a> supports
        that on iOS 26.5 and later. It opens the shielding app, not the distracting app. The older-version
        fallback closes the distracting app and leaves the restriction in place.
      </p>
      <p>
        Duration menus have their own availability boundary: <a href="https://developer.apple.com/documentation/managedsettingsui/shieldconfiguration/secondarybuttonsubmenuitems">secondaryButtonSubmenuItems</a>{" "}
        arrived in iOS 26.4 and supports up to three choices. Earlier supported versions use our
        two-button picker: one button cycles the displayed duration, and an explicit primary-button
        action grants that displayed choice. Navigation and cancellation must never be interpreted
        as accepting a duration.
      </p>
      <p>
        Cached shields make that last rule especially useful. A button can outlive the state that
        rendered it. We classify the current state again and use <a href="https://developer.apple.com/documentation/managedsettings/shieldactionresponse/defer">.defer to redraw</a>{" "}
        when an old menu no longer matches the current lock. Repeated taps reuse a valid allowance;
        they do not silently reset its deadline.
      </p>

      <h2>Granting access became a transaction</h2>
      <p>
        Saving a pass and hoping a background timer would be registered later was not acceptable.
        Neither was waiting forever inside a shield action. The current path has a two-second response
        budget and this ordering:
      </p>
      <ol>
        <li>Check eligibility and persist a unique <strong>pending</strong> session. Pending sessions grant no exemption.</li>
        <li>Leave the shared-state lock, drain obsolete timer registrations, and register the new native monitor.</li>
        <li>Reacquire state and recheck the request deadline, session generation, eligibility, and real locks.</li>
        <li>Apply the candidate exemption, keeping the on-disk session pending until the shield write returns.</li>
        <li>Persist the committed pass and complete the shield action exactly once.</li>
      </ol>
      <p>
        Monitor start, stop, and inventory calls run outside the cross-process writer lock. Timed
        expiry callbacks reconcile stored state and restrictions without querying or reconfiguring
        monitor registrations. A separate response lock is never held across storage or SDK calls,
        so the watchdog can reply even when those operations stall. The shared writer lock also has
        a bounded wait rather than blocking a tap indefinitely.
      </p>
      <p>
        If timeout wins, the handler replies before doing cleanup, rejects a late success, and rolls
        back only that request's generation. A synchronous Apple IPC call already in flight cannot
        be canceled, so its eventual result still needs reconciliation. For a quick registration
        failure, we save the explanation before replying with a redraw. That fixed the especially
        frustrating case where a choice appeared to do nothing and the error had not been saved yet.
      </p>
      <p>
        Cleanup cannot depend entirely on work after the reply; the extension may be suspended.
        Obsolete monitors are queued persistently and retired before the next registration. Apple's
        <a href="https://developer.apple.com/documentation/deviceactivity/deviceactivitycenter/monitoringerror/excessiveactivities"> twenty-activity limit is shared by the app and its extensions</a>,
        so leaked registrations can prevent later passes. We protect live allowances and required-lock
        monitors rather than evicting a real punishment to make room for a break.
      </p>

      <h2 id="authorization">The timer fix exposed a permission check that was wrong</h2>
      <p>
        The revised schedule still did not make the app open on the affected iPhone. It did produce
        a more useful failure: Screen Time needed approval, despite access being enabled in Settings.
        The report from build 117 recorded <code>lastGrantFailure.phase: "grant_ineligible"</code>,
        no sessions, and schedule revision 3. That attempt had stopped at eligibility, before session
        preparation or timer registration. More timer tuning would not address that recorded failure.
      </p>
      <p>
        The old grant code read <code>AuthorizationCenter.shared.authorizationStatus</code> from
        the shield extension's background registration queue. Other reconciliation paths made similar
        direct reads. Apple's <a href="https://developer.apple.com/documentation/familycontrols/authorizationcenter/authorizationstatus">authorizationStatus contract</a>{" "}
        says the initial value is <code>.notDetermined</code>, it is initialized through an
        authorization request, and it must be accessed on the main queue. A newly running extension's
        initial value was not reliable evidence that the user had revoked access.
      </p>
      <p>
        We had not captured the precise enum value from the failing extension, so the initialization
        timing remains an inference. The failed eligibility check was captured. The threading and
        initialization assumptions in our code were concrete problems worth removing.
      </p>
      <p>
        I moved live authorization requests and observation into the host app on <code>MainActor</code>.
        It publishes confirmed results into the App Group before resolving the permission or status
        request. The action and monitor extensions consume that receipt instead of initializing their
        own authorization centers for every decision.
      </p>
      <Code>{`// The policy, in abbreviated form:
switch confirmedHostResult {
case .approved:
  persistApprovalReceipt()
case .denied:
  persistDenialAndRetirePasses()
case .notDetermined:
  break // An initializing process must not overwrite a confirmed result.
}`}</Code>
      <p>
        Those helper names summarize the policy rather than providing a drop-in implementation.
        The production host also shares concurrent requests, refreshes existing setups on activation,
        observes changes, and prevents an older asynchronous completion from overwriting a newer
        observation. Cancellation requires an explicit retry; transient automatic failures back off.
      </p>
      <p>
        A saved approval receipt is application state, not a replacement permission system.
        DeviceActivity still has to accept registration before access can be committed. An explicit
        denial supersedes an old approval. The distinction we needed was between confirmed denial
        and a process that had not finished establishing its local state.
      </p>

      <h3>Signing permission and runtime permission are separate checks</h3>
      <p>
        Family Controls also requires the correct capabilities and signing setup. Apple's
        <a href="https://developer.apple.com/documentation/familycontrols/requesting-the-family-controls-entitlement"> distribution entitlement guidance</a>{" "}
        covers the app and its Screen Time extensions. Main-app approval does not establish that
        every extension is correctly configured. App Group membership also has to match the processes
        that share state.
      </p>
      <p>
        We inspected the already-built IPA for build 117 rather than starting another build on a hunch.
        The host, ShieldAction, ShieldConfiguration, and monitor binaries had signed Family Controls
        and the intended App Group. Their embedded profiles matched, the identifiers and team lined
        up, and the extensions contained the shared controller. That ruled out missing declared or
        signed entitlements in that inspected artifact. It did not prove runtime authorization or
        callback delivery was healthy.
      </p>
      <p>
        This is the distinction I would check early: developer capability, signed binary and profile,
        user authorization, and our persisted understanding of authorization are separate layers.
        “Screen Time permission is broken” was too broad a diagnosis to help.
      </p>

      <h2 id="storage">The last failure was our definition of a successful save</h2>
      <p>
        In build 118, I approved Apple's permission sheet and then got another error: “Screen Time
        access is updating. Try again.” This time the persistent diagnostic journal let us see the
        sequence. The already-approved repeat request completed successfully in roughly three
        milliseconds. Then our receipt save was rejected:
      </p>
      <Code>{`authorization_request_finished
  requestSucceeded: true

authorization_receipt
  status: approved
  confirmedStatus: approved
  accepted: false

state_sync_failed / save_failed
  operation: sessions_sync`}</Code>
      <p>
        This is a condensed transcription of the recorded fields, not a complete raw report. The
        App Group container was available. The separate diagnostic file journal had no write failures.
        There were no sessions, selected apps, or registered monitors in that snapshot.
      </p>
      <p>
        Our critical save functions used the Boolean from <code>UserDefaults.synchronize()</code>{" "}
        as their commit acknowledgment. A false result made our code reject the authorization receipt
        and abort session reconciliation, even after the system authorization request succeeded.
        The report did not explain why the preferences service returned false, and it did not prove
        those preference writes were durable.
      </p>
      <p>
        Apple explicitly says <a href="https://developer.apple.com/documentation/foundation/userdefaults/synchronize()">synchronize is unnecessary and should not be used</a>.
        The repair was to stop basing these critical records on that call. Simply ignoring an error
        and claiming everything saved would have hidden the distinction we needed to preserve.
      </p>
      <p>
        Authorization, app selection, sessions, and the duration picker now use a shared state store
        backed by atomic files in the App Group. Writes throw on failure, and the caller waits for
        that operation to complete before reporting success. Writers use the existing cross-process
        lock; readers read the canonical files without needing a writable lock.
      </p>
      <Code>{`// Excerpt from the critical-state store on iOS.
try data.write(
  to: recordURL,
  options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
)

// Compatibility mirror for older consumers, after the canonical write.
defaults.set(data, forKey: legacyKey)`}</Code>
      <p>
        That excerpt shows the binary-data records; the authorization mirror keeps its older
        dictionary shape. A missing canonical file may migrate legacy defaults under the writer
        lock. Once a canonical file exists, it wins. An unreadable or corrupt file must not resurrect
        a stale pass from defaults. An empty saved sessions file is meaningful: it says those passes
        were cleared.
      </p>
      <p>
        App selection follows the same completion rule. The picker persists its selection and
        reconciles enforcement on the worker queue before resolving success. Onboarding checks that
        demo setup returned a configured gate before advancing. A “Done” button cannot mean “we queued
        the save and hope the extension will see it.”
      </p>
      <p>
        There was also a separate JavaScript error. The onboarding catch blocks tried another native
        status request immediately after a permission or picker failure. When that second request
        rejected, it escaped as an uncaught promise. Removing those implicit retries let the original
        error appear and guaranteed busy state cleared. That correction could ship through JavaScript;
        the native storage correction needed an updated installed client.
      </p>

      <h2 id="verification">Diagnostics finally let us stop guessing</h2>
      <p>
        “The app did not open” could mean routing, eligibility, storage, monitor registration, a timeout,
        another restriction, or visible shield behavior. We added a persistent timeline across the host
        and extensions, with process/run IDs, session IDs, timestamps, SDK error domains and codes, and
        the important stage transitions.
      </p>
      <div className="stp-table" role="region" aria-label="Useful failure signatures" tabIndex={0}>
        <table>
          <thead><tr><th>Observed evidence</th><th>What to investigate</th></tr></thead>
          <tbody>
            <tr><td><code>grant_ineligible</code> before a session exists</td><td>Authorization receipt, selection, task/demo state, or a real required lock.</td></tr>
            <tr><td><code>monitor_failed</code></td><td>The SDK's actual error, including capacity or registration rejection.</td></tr>
            <tr><td>Successful system approval, rejected receipt</td><td>Our persistence path, as in build 118.</td></tr>
            <tr><td>Accepted grant, settings write returned, shield still visible</td><td>Other stores, current lock inputs, and the observed OS presentation.</td></tr>
            <tr><td>Expiry callback recorded, reconciliation failed</td><td>State, lock contention, or enforcement writes after delivery.</td></tr>
            <tr><td>Expiry repaired only after opening the host</td><td>Whether autonomous delivery/enforcement worked before that repair.</td></tr>
          </tbody>
        </table>
      </div>
      <p>
        The exported report omits app tokens and names, task text and identifiers, websites, and usage
        history. Logging is bounded and best effort. A missing event can mean a process died before
        flushing its journal; it does not automatically prove Apple never called the extension.
      </p>
      <p>
        The most useful testing rule was to observe the result <strong>before returning to Due or
        Die</strong>. Opening the host legitimately refreshes authorization and reconciles deadlines.
        That can repair the exact failure you are trying to inspect. The diagnostic export itself
        is read-only, but getting back into the app can already have changed the situation.
      </p>

      <h3>What passed, and what that actually means</h3>
      <p>
        The saved November 9 verification run had 100 related checks: 95 passed, none failed, and five
        Swift checks were skipped. The full run had 533 checks: 521 passed, six existing failures, and
        six skipped Swift checks. The recorded failures covered Android permission/alarm expectations,
        starter-task scheduling, and onboarding markup. That was useful regression evidence, but it
        was not a clean full-suite result or proof of iOS behavior.
      </p>
      <p>
        Some tests execute production JavaScript with native stubs; others inspect native wiring.
        Foundation-only Swift harnesses cover deadline math, stale callbacks, request races,
        authorization ordering, and state-store migration when a Swift compiler is available. This
        Windows development machine could not run those Swift harnesses. Source assertions and a
        grammar check were never a substitute for compiling and testing the installed extensions.
      </p>
      <p>
        After the implementation changes, I confirmed the two normal-path failures were resolved on
        my physical iPhone: a selected duration reveals the app on the first attempt, and expiry
        brings the shield back. That confirmation updates the older notes, which still marked the
        last device run as pending. It does not supply a measured latency distribution, establish
        which expiry callback fired, or validate every supported device and edge case.
      </p>
      <p>
        For the recovery path, there is a development-only probe that deliberately ignores one new
        allowance's primary callback. The intended test is to stay in the distracting app, observe
        the shield return through the warning five seconds later, then inspect the saved receipts.
        I would require that separate trial before calling the backup proven. An ordinary successful
        expiry does not exercise a missed primary callback.
      </p>

      <h2>The checks I would run before shipping another Screen Time change</h2>
      <ol>
        <li><strong>Test the first attempt.</strong> Save the selection, start the gate, open the target app, and select each duration without using a host-app detour as a workaround.</li>
        <li><strong>Stay on a static screen.</strong> Let one minute expire without switching apps, reopening the host, or relying on an unrelated UI event to trigger enforcement.</li>
        <li><strong>Repeat expiry and regrant.</strong> Request another pass from the time-up shield. Verify duplicate taps do not refill it and old callbacks cannot end the new generation.</li>
        <li><strong>Leave across the deadline.</strong> Background the app or lock the phone. Elapsed allowances should continue to expire while away.</li>
        <li><strong>Separate demo and ordinary tests.</strong> Test a ten-minute allowance outside the ten-minute demo; the demo ending can otherwise conceal an allowance problem.</li>
        <li><strong>Exercise required locks.</strong> Start task, work, focus, and punishment locks during a pass. Extra-time choices must disappear and the real lock must win.</li>
        <li><strong>Test midnight and lifecycle changes.</strong> Verify the local day boundary, time-zone/DST cases, permission revocation, process restarts, and stale saved state.</li>
        <li><strong>Force recovery and failure.</strong> Skip the primary in development, exercise registration and save failures, and confirm errors stay responsive without granting unmonitored access.</li>
        <li><strong>Use the installed native build.</strong> These Swift and extension changes need an updated development client or distribution build. Expo Go and a JS reload cannot add them.</li>
      </ol>
      <p>
        Due or Die's Android implementation reaches the same elapsed-time behavior through its
        Accessibility service and overlay, with its own native enforcement loop. The product rules
        are shared; the iOS callback strategy is not an Android implementation recipe.
      </p>

      <h2>What ultimately worked</h2>
      <p>
        The working flow came from fixing the whole chain: explicit eligibility, persisted deadlines,
        future monitor registration, bounded grant handling, host-confirmed authorization, and a
        critical-state save that could report its own failure correctly. The final storage correction
        addressed the concrete build-118 rejection, but it sat on top of the earlier scheduling and
        authorization repairs. A single API call was never going to repair every failure.
      </p>
      <p>
        For anyone building the same interruption, I would start by recording exactly where a choice
        stops: before eligibility, before persistence, during registration, during shield mutation,
        or after the app should have reopened. Then test expiry without letting the host quietly
        repair it. Those observations were what finally turned this from “Screen Time is acting weird”
        into bugs I could actually fix.
      </p>
    </article>
  );
}
