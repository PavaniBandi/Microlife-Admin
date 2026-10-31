import 'dotenv/config'
import app from './app.js'

const port = process.env.PORT || 8787
app.listen(port, () => {
  console.log(`Microlife API on http://localhost:${port}`)
})
