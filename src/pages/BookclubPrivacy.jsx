import { Link } from "react-router-dom";
import BookclubPage from "../components/BookclubPage.jsx";

export default function BookclubPrivacy() {
  return <BookclubPage
    title="Bookclubr Privacy Policy"
    description="How Bookclubr collects, uses, shares, and deletes account, reading, club, and guest voting information, and how to contact us about your privacy."
    path="/bookclub/privacy"
  >
    <article className="bookclub-policy">
      <p className="bookclub-eyebrow">Your information</p>
      <h1 className="bookclub-title">Privacy policy</h1>
      <p className="bookclub-muted">Effective October 6, 2026 · Last updated October 6, 2026</p>
      <p>Bookclubr is a reading and book club app operated by Marcus Taylor. This policy covers the Bookclubr app and its marketing, support, privacy, and guest voting pages at marcustaylor.org/bookclub. It explains what information is handled when you use these services.</p>

      <h2>Information we collect</h2>
      <ul>
        <li><strong>Account and profile:</strong> your email address, account identifier, display name, username, and profile photo if you add one. Email and password authentication is handled by Supabase Auth. If you choose Sign in with Apple, Apple provides a sign-in identifier and may provide your name and email address, including a private relay address.</li>
        <li><strong>Reading information:</strong> books you save, shelf status, reading and completion dates, ratings, reviews, reading goals, and progress. If you import a Goodreads CSV, the file is read on your device; imported book and reading information is saved to your account. The CSV file itself is not uploaded to Bookclubr's backend.</li>
        <li><strong>Social and club information:</strong> friendships, follows, club memberships, posts, replies, reactions, direct messages and their read status, nominations, rankings, votes, and discussion locations or addresses you enter.</li>
        <li><strong>Library preferences:</strong> the names and identifiers of libraries you choose for Libby searches, and your default library preference. Bookclubr does not ask for your library card number, library PIN, or Libby password.</li>
        <li><strong>Guest participation:</strong> a random browser identifier, the name you enter when nominating, your nominated book, ballot rankings, and submission records. The browser identifier is stored in local storage so the same browser can return to its participation.</li>
        <li><strong>Device and service information:</strong> a push notification token and device platform if you allow notifications. Hosting and infrastructure providers may process IP addresses, request details, timestamps, and operational logs when providing the service.</li>
        <li><strong>Support correspondence:</strong> your email address and the information or attachments you choose to send when contacting support.</li>
      </ul>

      <h2>How we use information</h2>
      <p>We use this information to sign you in, keep your library and profile available, run clubs and voting, show reading activity, deliver messages and optional notifications, remember preferences, respond to support requests, and maintain the security and reliability of the service. Bookclubr does not sell personal information or use it for targeted advertising.</p>

      <h2>What other people can see</h2>
      <p>Bookclubr has social features. Your profile, shelves, ratings, reviews, and profile posts can be viewed by other signed-in readers. Reading activity may appear in profile or social feeds. Club members can see shared club content, goals, progress, discussion locations, and voting information as exposed by the relevant feature. Direct messages are available to the sender and recipient within the app.</p>
      <p>Profile and club images are served using public image URLs; anyone who obtains an image URL may be able to view it. Anyone with a guest vote link can access the information shown on that voting page. Guest nomination names may appear with nominations, results, and club history. Treat shared links and anything you post as information intended for that audience.</p>

      <h2>Service providers and external services</h2>
      <p>Information is processed by providers needed to deliver the features you use:</p>
      <ul>
        <li><strong>Supabase:</strong> account authentication, database records, uploaded images, and backend functions.</li>
        <li><strong>Expo and Apple:</strong> push notification delivery, including your push token and notification content. Notifications can include names, book or club details, or a message preview. Apple also handles Sign in with Apple when selected.</li>
        <li><strong>Open Library / Internet Archive:</strong> book search, metadata, and cover images. Requests can include search terms, book identifiers, or ISBNs and expose normal network information such as an IP address.</li>
        <li><strong>OverDrive / Libby:</strong> library search and catalog lookup. Opening a book search in Libby passes the selected library and book search terms to that service.</li>
        <li><strong>Apple Maps and your calendar app:</strong> a discussion address is passed to Maps when you open it; deadline and discussion details are used when you choose to add a calendar event.</li>
        <li><strong>Vercel:</strong> hosting the Bookclubr web pages and collecting basic web traffic analytics on the public informational pages. Guest voting routes exclude Vercel Web Analytics.</li>
      </ul>
      <p>The public web pages also load fonts from Google Fonts. Your browser makes requests to Google to load those fonts. These providers may process data in countries other than where you live and handle data under their own terms and privacy practices.</p>
      <p>Vercel describes its Web Analytics as using no analytics cookies and collecting page views, referrers, and general device or browser information without identifiers used to track people across sites. See <a href="https://vercel.com/docs/analytics/privacy-policy">Vercel's analytics privacy documentation</a> for details. The Bookclubr mobile app does not include an advertising or behavioral analytics SDK.</p>
      <p>We may also disclose information when required by law or when necessary to address abuse, protect people, or secure the service.</p>

      <h2>Permissions and local storage</h2>
      <p>Photos are used only when you choose an image to upload. Calendar access is used for events you choose to add. Notifications are optional. You can change these permissions in your iPhone's Settings app. Bookclubr does not request your contacts or track your device's precise location; discussion addresses are entered by club organizers.</p>
      <p>The app stores a sign-in session and display preferences locally. Guest voting uses browser local storage for its random participant identifier. Clearing browser site data removes that local identifier, but does not delete a nomination or ballot already saved on the server.</p>

      <h2>Retention and deletion</h2>
      <p>Account and reading records are kept while your account remains active, unless you remove them through available app controls or delete your account. Uninstalling Bookclubr or logging out does not delete your account.</p>
      <p>To delete your account, open the settings gear in Bookclubr, choose <strong>Delete account</strong>, and confirm <strong>Permanently delete account</strong>. This deletes your sign-in account and personal records, including your profile, uploaded account photos, shelves, reviews, messages, personal activity, and notification tokens.</p>
      <p>Clubs with other members and their shared book, goal, nomination, and voting history can remain, with your account attribution removed where those shared records are retained. A remaining member takes over a club you organize alone. Shared book catalog records are retained. Guest participation is stored separately from app accounts and is not automatically removed by deleting an app account.</p>
      <p>For help deleting guest participation, support correspondence, or information you cannot remove in the app, email us. Include the relevant club or vote and enough information to locate your record; do not send passwords or sign-in codes. We may need to verify that a request concerns your information.</p>
      <p>Provider backups and operational logs may retain copies for limited periods under the providers' retention practices. Information may also need to be retained to meet legal obligations, resolve disputes, or protect the service. Deleting an account does not remove copies other people have independently saved, such as screenshots or calendar events.</p>

      <h2>Your choices and privacy requests</h2>
      <p>You can edit your profile, manage reading records, choose whether to use optional integrations, revoke device permissions, and delete your account. Depending on where you live, you may have rights to access, correct, receive a copy of, or request deletion of your personal information, or object to certain processing. Contact us to make a request or ask how your information is used.</p>

      <h2>Security</h2>
      <p>Bookclubr uses HTTPS connections and backend access controls to protect information. Access is limited according to the relevant account or feature. No internet service can guarantee absolute security; avoid putting sensitive personal information in public profiles, posts, guest names, or discussion addresses.</p>

      <h2>Children's privacy</h2>
      <p>Bookclubr is not directed to children under 13, and we do not knowingly collect personal information from children under 13. If you believe a child has provided personal information, contact us so we can investigate and remove it as appropriate.</p>

      <h2>Changes to this policy</h2>
      <p>We may update this policy as Bookclubr changes. The updated policy will appear here with a revised date. Material changes will be communicated as appropriate.</p>

      <h2>Contact</h2>
      <p>For privacy questions or requests, contact Marcus Taylor at <a href="mailto:taylor.marcus99@gmail.com?subject=Bookclubr%20privacy">taylor.marcus99@gmail.com</a>. You can also visit <Link to="/bookclub/support">Bookclubr Support</Link>.</p>
    </article>
  </BookclubPage>;
}
