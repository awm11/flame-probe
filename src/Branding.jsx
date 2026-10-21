import BuyMeCoffeeButton from './BuyMeCoffee'
import './Branding.css'

const SITE_HOME = '/'
const CONTACT_EMAIL = 'hello@alexmoorephysics.com'
const LOGO_SRC = `${import.meta.env.BASE_URL}favicon.svg`

// The awm Physics logo, linking back to the gallery of simulations.
export function BrandLogo({ className = '' }) {
  return (
    <a
      className={`awm-logo-link ${className}`.trim()}
      href={SITE_HOME}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="See other simulations at alexmoorephysics.com"
      title="See other simulations"
    >
      <img src={LOGO_SRC} alt="" />
    </a>
  )
}

// One row of support links: more simulations, contact email, Buy me a coffee.
export function SupportLinks({ className = '' }) {
  return (
    <div className={`awm-support ${className}`.trim()}>
      <a className="awm-more-sims" href={SITE_HOME} target="_blank" rel="noopener noreferrer">
        <img src={LOGO_SRC} alt="" />
        <span>See other simulations</span>
      </a>
      <a className="awm-contact" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
      <BuyMeCoffeeButton />
    </div>
  )
}
