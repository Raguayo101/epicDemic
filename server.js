const path = require('path');
const express = require('express');
const session = require('express-session');
const exphbs = require('express-handlebars');

const routes = require('./controller/api');
const profileRoutes = require('./controller/profileRoutes')
const gameRoutes = require('./controller/gameRoutes')
const registerRoute = require('./controller/registerRoute')
const helpers = require('./utils/helpers/helpers');
const hbs = exphbs.create({ helpers });

const sequelize = require('./config/connection');
const SequelizeStore = require('connect-session-sequelize')(session.Store);

const app = express();
const server = require('http').createServer(app);;
const PORT = process.env.PORT || 3001;
var io = require('socket.io')(server);

let players = [];



const sess = {
  secret: 'Super secret secret',
  cookie: {},
  resave: false,
  saveUninitialized: true,
  store: new SequelizeStore({
    db: sequelize
  })
};

app.use(session(sess));

// Inform Express.js on which template engine to use
app.engine('hbs', exphbs({
  defaultLayout: 'main',
  extname: '.hbs'
}));
app.set('view engine', 'hbs');

app.get('/', (req, res) => {
  res.render('homepage');
});


app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(routes);
app.use(profileRoutes);
app.use(gameRoutes);
app.use(registerRoute);


io.on('connection', function (socket) {
  console.log('a user connected: ' + socket.id);

  players.push(socket.id);
  console.log(players);
  
  socket.on('disconnect', function () {
    console.log('user disconnected: ' + socket.id);
    players = players.filter(player => player !== socket.id);
  });
});

sequelize.sync({ force: false }).then(() => {
  server.listen(PORT, () => console.log('Now listening'));
});