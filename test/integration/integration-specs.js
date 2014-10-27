var _ = require('lodash');
var FixtureGenerator = require('../../lib/fixture-generator');

module.exports = function(dbConfig) {
  describe('FixtureGenerator', function() {
    this.enableTimeouts(false);

    before(function(done) {
      this.fixtureGenerator = new FixtureGenerator(dbConfig);
      var knex = this.knex = this.fixtureGenerator.knex;
      knex.schema.createTable('Users', function(table) {
        table.increments('id').primary();
        table.string('username');
        table.string('autoPopulatedColumn').notNullable().defaultTo('autopopulated');
      }).then(function() {
        knex.schema.createTable('Items', function(table) {
          table.increments('id').primary();
          table.string('name');
          table.integer('userId').references('id').inTable('Users');
        }).then(function() {
          knex.schema.createTable('Comments', function(table) {
            table.increments('id').primary();
            table.string('comment');
            table.integer('userId');
            table.integer('itemId');
            table.integer('parentId');
            table.integer('createdById').references('id').inTable('Users');
          }).then(function() {
            knex.schema.createTable('LikeVotes', function(table) {
              table.increments('id').primary();
              table.integer('commentId').references('id').inTable('Comments');
              table.integer('createdById').references('id').inTable('Users');
            }).then(function() {
              knex.schema.createTable('HasNoIdColumn', function(table) {
                table.integer('foreignAId');
                table.integer('foreignBId');
                table.string('autoPopulatedColumn').notNullable().defaultTo('autopopulated');
              }).then(function() {
                done();
              });
            });
          });
        });
      });
    });

    after(function(done) {
      this.fixtureGenerator.destroy(done);
    });

    describe("generating fixtures", function() {
      it('should create a fixture with dependencies resolved', function(done) {
        var dataConfig = {
          Users: {
            username: 'bob'
          },
          Items: {
            name: "bob's item",
            userId: 'Users:0'
          }
        };

        var knex = this.knex;

        this.fixtureGenerator.create(dataConfig).then(function(results) {
          expect(results.Users[0].username).to.eql('bob');
          expect(results.Users[0].specId).to.be.undefined;
          expect(results.Items[0].userId).to.eql(results.Users[0].id);
          expect(results.Items[0].specId).to.be.undefined;

          // verify the data made it into the database
          knex('Users').where('id', results.Users[0].id).then(function(result) {
            expect(result[0].username).to.eql('bob');
            done();
          });
        });
      });

      it('should leave the passed in data spec alone', function() {
        var dataConfig = {
          Users: {
            username: 'bob'
          },
          Items: [
            {
              name: "bob's item",
              userId: 'Users:0'
            }
          ]
        };

        var originalConfig = _.cloneDeep(dataConfig);

        this.fixtureGenerator.create(dataConfig).then(function(results) {
          expect(results.Users[0].username).to.eql('bob');
          expect(originalConfig).to.eql(dataConfig);
        });
      });

      it('should properly deal with same types at different priorities', function(done) {
        var dataConfig = {
          Users: [{
            username: 'bob'
          }, {
            username: "Items:0:name"
          }],
          Items: {
            name: "bob's item",
            userId: 'Users:0'
          }
        };

        var knex = this.knex;
        this.fixtureGenerator.create(dataConfig).then(function(results) {
          expect(results.Users[0].id).to.be.a.number;
          expect(results.Users[1].id).to.be.a.number;
          expect(results.Items[0].id).to.be.a.number;

          expect(results.Users[0].username).to.eql('bob');
          expect(results.Users[1].username).to.eql("bob's item");
          expect(results.Items[0].name).to.eql("bob's item");
          expect(results.Items[0].userId).to.eql(results.Users[0].id);

          // verify the data made it into the database
          knex('Users').whereIn('id', [results.Users[0].id, results.Users[1].id]).then(function(result) {
            expect(result[0].username).to.eql('bob');
            expect(result[1].username).to.eql("bob's item");

            knex('Items').where('id', results.Items[0].id).then(function(result) {
              expect(result[0].name).to.eql("bob's item");
              done();
            });
          });
        });
      });

      it('should properly resolve same types at different priorities', function(done) {
        var dataConfig = {
          Users: [
            { username: "bob" }
          ],
          Comments: [{
            comment: 'comment 1',
            createdById: "Users:0",
            userId: "Users:0"
          }, {
            comment: 'child of 1',
            createdById: "Users:0",
            userId: "Users:0",
            parentId: "Comments:0"
          }],
          LikeVotes: [{
            commentId: "Comments:0",
            createdById: "Users:0"
          }, {
             commentId: "Comments:1",
             createdById: "Users:0"
          }]
        };

        var knex = this.knex;
        this.fixtureGenerator.create(dataConfig).then(function(results) {
          expect(results.Comments[1].parentId).to.be.a('number');
          expect(results.Comments[1].parentId).to.eql(results.Comments[0].id);

          expect(results.LikeVotes[1].commentId).to.be.a('number');
          expect(results.LikeVotes[1].commentId).to.eql(results.Comments[1].id);

          expect(results.LikeVotes[1].createdById).to.be.a('number');
          expect(results.LikeVotes[1].createdById).to.eql(results.Users[0].id);

          knex('LikeVotes').where('id', results.LikeVotes[1].id).then(function(result) {
            expect(result[0].commentId).to.eql(results.Comments[1].id);
            done();
          });
        });
      });

      // this spec asserts that issue #5 is resolved
      // in the below, the prioritization ends up moving the comments around
      // and so before the fix, results.Comments[0] is what the user expected to
      // find at results.Comments[1]
      it('should properly resolve dependencies that might move around', function(done) {
        var dataConfig = {
          Users: [{
            username: 'bob'
          }, {
            username: 'sally'
          }],
          Items: [{
            name: 'item 1',
            userId: 'Users:0'
          }],
          Comments: [{
            createdById: "Users:0",
            itemId: "Items:0",
            comment: "comment on challenge"
          }, {
            createdById: "Users:0",
            userId: "Users:1",
            comment: "comment on user 1's wall"
          }]
        };

        var knex = this.knex;
        this.fixtureGenerator.create(dataConfig).then(function(results) {
          expect(results.Comments[1].comment).to.eql("comment on user 1's wall");
          expect(results.Comments[1].userId).to.eql(results.Users[1].id);
          done();
        });
      });

      describe("tables without an id column", function() {
        it('should create rows for tables without an id column', function(done) {
          var dataConfig = {
            HasNoIdColumn: [{
              foreignAId: 2,
              foreignBId: 3,
              autoPopulatedColumn: null
            }, {
              foreignAId: 5,
              foreignBId: 6
            }]
          };

          var knex = this.knex;

          this.fixtureGenerator.create(dataConfig).then(function(results) {
            expect(results.HasNoIdColumn[0].foreignAId).to.eql(2);
            expect(results.HasNoIdColumn[0].foreignBId).to.eql(3);
            expect(results.HasNoIdColumn[0].autoPopulatedColumn).to.eql("autopopulated");
            expect(results.HasNoIdColumn[1].foreignAId).to.eql(5);
            expect(results.HasNoIdColumn[1].foreignBId).to.eql(6);
            expect(results.HasNoIdColumn[1]).to.not.have.property('autoPopulatedColumn');

            knex('HasNoIdColumn').where('foreignAId', 2).then(function(knexResult) {
              expect(knexResult[0].foreignBId).to.eql(3);
              expect(knexResult[0].autoPopulatedColumn).to.eql("autopopulated");
              done();
            });
          });
        });
      });

      describe("invoking raw sql", function() {
        it("should invoke raw sql", function(done) {
          var dataConfig = {
            Users: [{
              username: 'bob'
            }, {
              username: 'sally'
            }],
            sql: [
              'insert into "Items" ("name", "userId") values (\'rawsql0\', {Users:0})',
              'insert into "Items" ("name", "userId") values (\'rawsql1\', {Users:1})'
            ]
          };

          var knex = this.knex;
          this.fixtureGenerator.create(dataConfig).then(function(results) {
            expect(results.Users.length).to.eql(2);
            expect(results.Items).to.be.undefined;
            knex('Items').where('name', 'rawsql0').then(function(knexResult) {
              expect(knexResult[0].userId).to.eql(results.Users[0].id);
              knex('Items').where('name', 'rawsql1').then(function(knexResult) {
                expect(knexResult[0].userId).to.eql(results.Users[1].id);
                done();
              });
            });
          });
        });

        it('should allow raw sql in a column', function(done) {
          var knex = this.fixtureGenerator.knex;

          var dataConfig = {
            Users: [
              {
                username: knex.raw('?', ['bob'])
              }
            ]
          };

          this.fixtureGenerator.create(dataConfig).then(function(results) {
            expect(results.Users[0].username).to.equal('bob');
            done();
          });
        });
      });

      describe('auto populated columns', function() {
        it('should return the auto populated columns in the result', function(done) {
          var dataConfig = {
            Users: [
              {
                username: 'bob',
                autoPopulatedColumn: null
              },
              {
                username: 'joe'
              }
            ]
          };

          this.fixtureGenerator.create(dataConfig).then(function(results) {
            expect(results.Users[0].autoPopulatedColumn).to.eql('autopopulated');
            expect(results.Users[1]).to.not.have.property('autoPopulatedColumn');
            done();
          });
        });
      });
    });

    describe('spec ids', function() {
      it('should resolved spec ids', function(done) {
        var dataConfig = {
          Users: {
            specId: 'myUser',
            username: 'bob'
          },
          Items: {
            name: "bob's item",
            userId: 'Users:myUser'
          }
        };

        var knex = this.knex;
        this.fixtureGenerator.create(dataConfig).then(function(results) {
          expect(results.Users[0].username).to.eql('bob');
          expect(results.Items[0].userId).to.eql(results.Users[0].id);

          // verify the data made it into the database
          knex('Users').where('id', results.Users[0].id).then(function(result) {
            expect(result[0].username).to.eql('bob');
            done();
          });
        });
      });
    });

    describe('escaping', function() {
      it('should unescape colons', function(done) {
        var dataConfig = {
          Users: {
            username: 'foo::bar'
          }
        };

        var knex = this.knex;
        this.fixtureGenerator.create(dataConfig).then(function(results) {
          expect(results.Users[0].username).to.eql('foo:bar');

          // verify the data made it into the database
          knex('Users').where('id', results.Users[0].id).then(function(result) {
            expect(result[0].username).to.eql('foo:bar');
            done();
          });
        });
      });
    });

    describe('calling the callback', function() {
      it('should call the callback if provided', function(done) {
        var dataConfig = {
          Users: {
            username: 'bob'
          }
        };

        this.fixtureGenerator.create(dataConfig, function(err, results) {
          expect(err).to.be.undefined;
          expect(results.Users[0].username).to.eql('bob');
          done();
        });
      });
    });

    describe('reusing the instance', function() {
      it('should reconnect after a destroy', function(done) {
        var dataConfig = {
          Users: {
            username: 'bob'
          }
        };

        var fixtureGenerator = this.fixtureGenerator;

        fixtureGenerator.create(dataConfig, function(err, results) {
          expect(err).to.be.undefined;
          expect(results.Users[0].username).to.eql('bob');

          fixtureGenerator.destroy(function() {
            fixtureGenerator.create(dataConfig, function(err, results) {
              expect(err).to.be.undefined;
              expect(results.Users[0].username).to.eql('bob');
              done();
            });
          });
        });
      });
    });
  });
};