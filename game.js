var state = 0; //-1: starting, 0: not yet started, 1: night, 2: day, 3: finished

var dayStart = false;

var dayDuration = 60;
var nightDuration = 30;

var dayCount = 0;
var nightCount = 0;

var wills = false;



function checkVictory () {
	var refugeeVictory = (io.sockets.clients('zombie').length === 0);
	var zombieVictory = (io.sockets.clients('zombie') >= io.sockets.clients('refugee'));

	if (refugeeVictory) {
		endGame('The refugees band together and eradicate the zombie horde');
	} else if (zombieVictory) {
		endGame('BRAINS! The zombie horde has overun the outpost.');
	}

}

function playerDeathCleanup (socket) {
	socket.game_alive = false;
	socket.leave('alive');

	socket.emit('disableField', false);
	socket.emit('displayVote', true);
	socket.emit('disableVote', true);

	socket.game_role = null;
	socket.leave('refugee');
	socket.leave('zombie');
	socket.join('spectator');
}

function killPlayer (socket) {
	playerDeathCleanup(socket);
	io.sockets.emit('playerDied', socket.game_nickname);

	if (wills) {
		if (socket.game_will !== '') {
			io.sockets.emit('message', { message: socket.game_nickname + '\'s will: ' + socket.game_will});
		} else {
			io.sockets.emit('message', { message: socket.game_nickname + ' did not leave a will.'});
		}
	}

	checkVictory();
}

//roles
var roles = {
	civilian: {
		name: 'civilian', 
		group: 'refugee',
		power: false 
	},
	officer: {
		name: 'officer',
		group: 'refugee',
		power: true,
		powerFunc: function (socket, chosenPlayer) {
			socket.emit('message', { message: 'After your investigation, you conclude that ' + chosenPlayer.game_nickname + ' is a ' + chosenPlayer.game_role.group + '.'});
		}
	},
	doctor: {
		name: 'doctor',
		group: 'refugee',
		power: true,
		powerFunc: function (socket, chosenPlayer) {
			if (chosenPlayer.game_dying) {
				socket.emit('message', { message: 'You find ' + chosenPlayer.game_nickname + ' in a dimly lit corner of the refugee outpost, clutching their arm and blilthering nonsense. You lop off their arm before they turn.'});
				chosenPlayer.game_immunity = true;
			} else {
				socket.emit('message', { message: 'During your nightly rounds, you pay ' + chosenPlayer.game_nickname + ' a visit. All manor of postapocalyptic death and decay aside, they seem to be in good health.'});
			}
		}
	},
	zombie: {
		name: 'zombie',
		group: 'zombie',
		power: false
	}
};
//end role definitions

//ar playerRoles = [];

var playerRoles = [
	roles['civilian'],
	roles['civilian'],
	roles['civilian'],
	roles['officer'],
	roles['doctor'],
	roles['zombie'],
	roles['zombie']
];



function shuffle (array) {
	var m = array.length, t, i;

	while (m) {
		i = Math.floor(Math.random() * m--);

		t = array[m];
		array[m] = array[i];
		array[i] = t;
	}

	return array;
}

var announcement = '';

function updateAnnouncement (string) {
	announcement = string;
	io.sockets.emit('announcement', { message: announcement });
}

var header = '';

function updateHeader (string) {
	header = string;
	io.sockets.emit('header', { message: header });
}

function assignRoles () {
	var players = [];
	io.sockets.clients().forEach(function (socket) {
		players.push(socket);
	});
	players = shuffle(players);
	playerRoles = shuffle(playerRoles);
	console.log(playerRoles);
	console.log(players);
	for (var i = 0; i < players.length; i++) {
		if (i <= playerRoles.length - 1) {
			players[i].game_alive = true;
			players[i].join('alive');
			players[i].game_role = playerRoles[i];
			players[i].join(playerRoles[i].group);
			players[i].emit('message', { message: 'You have been assigned the role of ' + playerRoles[i].name + '.' });
			console.log(playerRoles);
			console.log(players);
		} else {
			players[i].game_alive = false;
			players[i].join('spectator');
			players[i].emit('message', { message: 'Since the roles are full, you have been assigned the role of spectator.' });
		}
	}
}

function endGame (winner) {
	state = 3;
	updateHeader('Game over');
	updateAnnouncement(winner);
	io.sockets.clients('alive').forEach(function (socket) {
		playerDeathCleanup(socket);
	});
	setTimeout(function () {
		state = 0;
		io.sockets.emit('message', { message: 'Refresh your browser to play again.' });
	}, 5000);

}

function countedVotes (arr) {
	var a = [], b = [], prev;

	arr.sort();
	for (var i = 0; i < arr.length; i++) {
		if (arr[i] !== prev) {
			a.push(arr[i]);
			b.push(1);
		} else {
			b[b.length-1]++;
		}
		prev = arr[i];
	}

	var results = [];

	for (var i = 0; i < a.length; i++) {
		results.push({'username': a[i], 'votes': b[i]});
	}

	results.sort(function (a, b) {
		return (b.votes - a.votes);
	});

	return results; //todo: randomize results if 2 players tie (currently sorts alphabetically)
}

function handleVotes () {
	var votes = [];
	if (state === 1) {
		votingGroup = 'zombie';
	} else {
		votingGroup = 'alive';
	}
	io.sockets.clients(votingGroup).forEach(function (socket) {
		if (!socket.game_vote) {
			votes.push('');
		} else {
			votes.push(socket.game_vote);
		}
	});

	var results = countedVotes(votes);
	if (results[0] && results[0].votes >= ((Math.floor(io.sockets.clients(votingGroup).length / 2)) + 1)) {
		io.sockets.clients().forEach(function (socket) {
			if (socket.game_nickname === results[0].username) {
				socket.game_dying = true;
			} else {
				socket.game_dying = false;
			}
		});
	}
}

function handlePowerVotes () {
	io.sockets.clients('alive').forEach(function (socket) {
		if (socket.game_powerVote && socket.game_role.power && socket.game_nickname != socket.game_powerVote) {
			io.sockets.clients().forEach(function (socket2) {
				if (socket.game_powerVote == socket2.game_nickname) {
					socket.game_role.powerFunc(socket, socket2);
					socket.game_powerVote = null;
				}
			});
		}
	});
}

var endDay = false;
function dayLoop(duration, ticks) {
	var ticksLeft = duration - ticks;
	if (state !== 3) {
		if (ticksLeft && !endDay) {
			updateAnnouncement('Day ends in ' + ticksLeft + ' second(s)');
			setTimeout(dayLoop, 1000, duration, ticks + 1);
		} else {
			if (dayCount > 0 || nightCount > 0) {
				handleVotes();
				io.sockets.clients('alive').forEach(function (socket) {
					if (socket.game_dying) {
						io.sockets.emit('message', { message: socket.game_nickname + ' was exiled from the refugee outpost!'});
						killPlayer(socket);
					}
				});
			}


			if (state !== 3) {
				nightCount++;
				updateHeader('Night ' + nightCount);
				updateAnnouncement('It is now nighttime');

				io.sockets.emit('clearTargets');
				io.sockets.emit('displayInventory', false);

				var validzombieTargets = [];
				io.sockets.clients('refugee').forEach(function (socket) {
					socket.emit('disableField', true);
					socket.emit('displayVote', false);
					validzombieTargets.push(socket.game_nickname);
				});

				io.sockets.in('zombie').emit('validTargets', validzombieTargets);

				var powerRoles = io.sockets.clients('alive').filter(function (socket) {
					return socket.game_role.power;
				});

				powerRoles.forEach(function (socket) {
					var validPowerTargets = [];

					io.sockets.clients('alive').forEach(function (socket2) {
						if (socket.game_nickname != socket2.game_nickname) {
							validPowerTargets.push(socket2.game_nickname);
						}
					});

					socket.emit('displayVote', true);
					socket.emit('validTargets', validPowerTargets);
				});

				var votingPlayers = [];
				io.sockets.clients('zombie').forEach(function (socket) {
					votingPlayers.push(socket.game_nickname);

					socket.game_hasVoted = false;
					socket.game_hasPowerVoted = false;
					socket.game_vote = null;
				});

				io.sockets.in('zombie').emit('votingPlayers', votingPlayers);

				setTimeout(nightLoop, 1000, nightDuration, 0);
				state = 1;
				endDay = false;
			}
		}
	}
}

function nightLoop(duration, ticks) {
	var ticksLeft = duration - ticks;
	if (state !== 3) {
		if (ticksLeft && !endDay) {
			updateAnnouncement('Night ends in ' + ticksLeft + ' second(s)');
			setTimeout(nightLoop, 1000, duration, ticks + 1);
		} else {
			if (dayCount > 0 || nightCount > 0) {
				handleVotes();
				handlePowerVotes();
				io.sockets.clients('alive').forEach(function (socket) {
					if (socket.game_dying) {
						if (socket.game_immunity) {
							socket.emit('message', { message: 'You wake up covered in bloodied bandages with a horrible headache. Weird... It seems you are missing an arm.'});
								socket.game_dying = false;
						} else {
							io.sockets.emit('message', { message: socket.game_nickname + ' was killed in the night!'});
							killPlayer(socket);
						}
					}

					socket.game_immunity = false; //immunity only lasts the night it is given
				});
			}

			if (state !== 3) { //surely there's a cleaner way to do this
				dayCount++;
				updateHeader('Day ' + dayCount);
				updateAnnouncement('It is now daytime');

				io.sockets.in('alive').emit('disableField', false);
				io.sockets.in('alive').emit('displayVote', true);

				io.sockets.in('alive').emit('clearTargets');

				var votingPlayers = [];
				io.sockets.clients('alive').forEach(function (socket) {

					votingPlayers.push(socket.game_nickname);

					socket.game_hasVoted = false;
					socket.game_hasPowerVoted = false;
					socket.game_vote = null;
				});

				io.sockets.in('alive').emit('validTargets', votingPlayers);
				io.sockets.emit('votingPlayers', votingPlayers);

				setTimeout(dayLoop, 1000, dayDuration, 0);
				state = 2;
				endDay = false;
			}
		}
	}
}

function initialize () {
	assignRoles();
	var livingPlayers = [];
	io.sockets.clients('alive').forEach(function (socket) {
		livingPlayers.push(socket.game_nickname);
	});


	if (wills) {
		io.sockets.emit('message', { message: 'This game session has wills enabled. Type /will to set yours.' });
		io.sockets.clients('alive').forEach(function (socket) {
			socket.game_will = '';
		});
	}

	io.sockets.in('alive').emit('playerList', livingPlayers);
	if (dayStart) {
		nightLoop(0, 0);
	} else {
		io.sockets.in('zombie').emit('displayVote', true);
		dayLoop(0, 0);
	}
}

var startingCountdownTimer = null;
function startingCountdown (duration, ticks) {
	var validClients = io.sockets.clients();
	validClients = validClients.filter(function (socket) {
		return (socket.game_nickname);
	});
	var numClients = validClients.length;
	var reqPlayers = playerRoles.length;
	if (numClients >= reqPlayers) { //need to move this redundant code to its own function
		var ticksLeft = duration - ticks;
		if (ticksLeft) {
			updateAnnouncement('Game starting in ' + ticksLeft + ' second(s)');
			startingCountdownTimer = setTimeout(startingCountdown, 1000, duration, ticks + 1);
		} else {
			updateAnnouncement('Game starting now');
			initialize();
		}
	} else {
		state = 0;
		updateAnnouncement('Waiting on ' + (reqPlayers - numClients) + ' more players');
	}
}

function hasEveryoneVoted () {
	var votedFlag = true;
	if (state === 1) {
		io.sockets.clients('alive').forEach(function (socket) {
			if (socket.game_role.power && !socket.game_hasPowerVoted) {
				votedFlag = false;
			} else if (socket.game_role.group == 'zombie' && !socket.game_hasVoted) {
				votedFlag = false;
			}
		});
	} else if (state === 2) {
		io.sockets.clients('alive').forEach(function (socket) {
			if (!socket.game_hasVoted) {
				votedFlag = false;
			}
		});
	}

	return votedFlag;
}

module.exports = {
	countdownTime: 0, //time before game starts once enough players have joined (in seconds)
	checkNumPlayers: function() {
		var validClients = io.sockets.clients();
		validClients = validClients.filter(function (socket) {
			return (socket.game_nickname);
		});
		var numClients = validClients.length;
		var reqPlayers = playerRoles.length;
		if(numClients >= reqPlayers) {
			updateAnnouncement('Required number of players reached');
			state = -1;
			startingCountdownTimer = setTimeout(startingCountdown, 1000, this.countdownTime, 0);
		} else {
			updateAnnouncement('Waiting on ' + (reqPlayers - numClients) + ' more players');
			clearTimeout(startingCountdownTimer);
		}
		updateHeader('Pre-game Lobby');
	},
	filterMessage: function(socket, data) {
		var clientRooms = io.sockets.manager.roomClients[socket.id];

		if (data.message[0] !== '/') {
			if (state === 0 || state === -1 || (state === 2 && socket.game_alive)) {
				io.sockets.emit('message', data);
			} else if (clientRooms['/spectator'] || !socket.game_alive) {
				data.message = '<font color="red">' + data.message + '</font>';
				io.sockets.in('spectator').emit('message', data);
			} else if (state === 1) {
				if (clientRooms['/zombie']) {
					io.sockets.in('zombie').emit('message', data);
				}
			}
		} else {
			var validCommand = false;

			//again will probably replace this with something that iterates through a list that gets built on startup
			//so people will be able to add their own chat commands without actually modifying the source
			if (wills && data.message.indexOf('/will ') === 0) {
				var willText = data.message.replace('/will ','');

				var maxWillLength = 140;
				if (willText.length > 0) {
					if (willText.length < maxWillLength) {
						socket.game_will = willText;
						socket.emit('message', { message: 'Your will has been revised.' });
					} else {
						socket.emit('message', { message: 'Please keep your will under ' + maxWillLength + ' characters.' });
					}
				} else {
					socket.emit('message', { message: 'Usage: /will [your will content]' });
				}

				validCommand = true;
			}

			if (!validCommand)
				socket.emit('message', { message: 'Command was not recognized.' });
		}
	},
	vote: function(socket, data) {
		data.username = socket.game_nickname;

		var isValid = true;
		var clientRooms = io.sockets.manager.roomClients[socket.id];
		if (!socket.game_role.power) {
			if (state === 1 && clientRooms['/zombie']) {
				io.sockets.in('zombie').emit('playerVote', data);
			} else if (state === 2) {
				io.sockets.emit('playerVote', data);
			} else {
				isValid = false;
			}
		} else {
			if (state === 1) {
				socket.game_powerVote = data.message;
			} else if (state === 2) {
				io.sockets.emit('playerVote', data);
			} else {
				isValid = false;
			}
		}

		if (isValid) {
			if (!socket.game_role.power || state === 2) {
				socket.game_vote = data.message; //this will have to be reworked once zombie power roles are introduced
				socket.game_hasVoted = true;
			} else {
				socket.game_hasPowerVoted = true;
			}

			if (hasEveryoneVoted()) {
				endDay = true;
			}
		}
	},
	state: function() {
		return state;
	},
	announcement: function() {
		return announcement;
	},
	header: function () {
		return header;
	},
	enableWills: function () {
		wills = true;
	},
	reset: function () {
		state = 3;
		setTimeout(function () {
			updateHeader('Refresh browser to play again');
			state = 0;
		}, 5000);
		console.log(state);
	},
	checkVictory: function () {
			var refugeeVictory = (io.sockets.clients('zombie').length === 0);
			var zombieVictory = (io.sockets.clients('zombie') >= io.sockets.clients('refugee'));
		
			if (refugeeVictory) {
				endGame('The refugees band together and eradicate the zombie horde');
			} else if (zombieVictory) {
				endGame('BRAINS! The zombie horde has overun the outpost.');
			}
		
	}
};