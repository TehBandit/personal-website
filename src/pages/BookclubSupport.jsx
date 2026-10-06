import BookclubPage from "../components/BookclubPage.jsx";

const supportEmail = "taylor.marcus99@gmail.com";

export default function BookclubSupport() {
  return <BookclubPage
    title="Bookclubr Support | Help with your books and clubs"
    description="Get help with Bookclubr sign-in, book clubs, guest voting, Goodreads imports, notifications, and account deletion. Contact the developer for support."
    path="/bookclub/support"
  >
    <section className="bookclub-support-intro" aria-labelledby="bookclub-support-title">
      <p className="bookclub-eyebrow">Bookclubr support</p>
      <h1 id="bookclub-support-title" className="bookclub-title">A little help for<br />your next chapter.</h1>
      <p className="bookclub-lead">Having trouble with your books or your club? Start with the answers below, or contact Marcus Taylor, the developer of Bookclubr.</p>
    </section>

    <section className="bookclub-card bookclub-contact-card" aria-labelledby="bookclub-contact-title">
      <span className="bookclub-label">Contact support</span>
      <h2 id="bookclub-contact-title" className="bookclub-heading">Let's get you reading again.</h2>
      <p>Email a description of the issue, the steps that led to it, and any error message you see. Your iPhone model, iOS version, and Bookclubr version help with troubleshooting. Screenshots are welcome; hide any personal information first.</p>
      <div className="bookclub-actions">
        <a className="bookclub-button" href={`mailto:${supportEmail}?subject=Bookclubr%20support`}>Email Bookclubr support</a>
      </div>
      <p className="bookclub-contact-address"><a href={`mailto:${supportEmail}?subject=Bookclubr%20support`}>{supportEmail}</a></p>
      <p className="bookclub-muted">You can contact support without signing in. Please never send passwords, sign-in links, or verification codes.</p>
    </section>

    <section className="bookclub-section" aria-labelledby="bookclub-help-title">
      <p className="bookclub-eyebrow">Common questions</p>
      <h2 id="bookclub-help-title" className="bookclub-section-title">Find your way back to the book.</h2>
      <div className="bookclub-faq">
        <details>
          <summary>I can't sign in or find my confirmation email.</summary>
          <div>
            <p>Use the same sign-in method you used to create your account: email and password, or Continue with Apple. Check your spam folder for confirmation or sign-in emails, and open the link on the iPhone where Bookclubr is installed.</p>
            <p>If you use email sign-in and can't remember your password, enter your email on the Log in screen and choose <strong>Email me a sign-in link</strong>. Request a fresh link if the old one has expired. If you're still stuck, email support with the error message.</p>
          </div>
        </details>
        <details id="guest-voting">
          <summary>How do I join a guest vote?</summary>
          <div>
            <p>Open the full link shared by your club organizer. You can take part in your browser without an account or the app. Follow the page's instructions to nominate a book or rank the options, then submit.</p>
            <p>If a link is invalid or unavailable, ask the organizer for the latest one. Sharing a new guest link replaces the previous link. Only the organizer can open or close voting.</p>
            <p>Use the same browser and keep its site data if you want to return to your ballot. Private browsing or clearing browser data can prevent the page from recognizing your earlier vote.</p>
          </div>
        </details>
        <details>
          <summary>How do I import my Goodreads library?</summary>
          <div>
            <p>On the Goodreads website, go to <strong>My Books → Import and export → Export Library</strong> and save the CSV file. In Bookclubr, open the settings gear and choose <strong>Import from Goodreads</strong>. Choose your CSV, review the counts, and confirm the import.</p>
            <p>Keep Bookclubr open while it imports. If covers or descriptions are missing, use <strong>Find missing details</strong> on the import screen. Some books may not have matching details in Open Library.</p>
          </div>
        </details>
        <details>
          <summary>Why am I not receiving notifications or calendar reminders?</summary>
          <div>
            <p>In Bookclubr's settings, choose <strong>Notification settings</strong> to open the app's iPhone settings. Check that notifications are allowed, and check whether Focus or Scheduled Summary is delaying alerts.</p>
            <p>Calendar events are optional. If you can't add a reading deadline, check Bookclubr's calendar permission in your iPhone's Settings app, then try adding the event again.</p>
          </div>
        </details>
        <details>
          <summary>How do I delete my account?</summary>
          <div>
            <p>Open Bookclubr's settings gear, choose <strong>Delete account</strong>, then confirm <strong>Permanently delete account</strong>. This removes your account and personal data, including your profile, photos, shelves, reviews, messages, and personal activity. Deletion cannot be undone.</p>
            <p>Clubs with other members and their shared reading history stay available. Another member takes over a club you organize alone. If you can't access your account, contact support for help.</p>
          </div>
        </details>
        <details>
          <summary>How do I report a bug or suggest a feature?</summary>
          <div>
            <p>Email support with what happened and what you expected instead. For a feature idea, tell us how it would help you or your club read together. For a problem with a book's details, include its title and author.</p>
          </div>
        </details>
      </div>
    </section>
  </BookclubPage>;
}
