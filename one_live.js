
/*
const SportType = {
    Unknown: -1,
    Soccer: 0,
    Basketball: 1,
    Tennis: 2
};

const MatchState = {
    Undefined: 0,

    NotStarted: 1,

    HalfTime: 2,
    Ended: 3,

    Overtime: 11,
    Overtime2: 12,

    Delay: 20,
    Interrupt: 21,
    CutInHalf: 22,
    Cancel: 23,
    ToBeDetermined: 34,

    // Soccer
    FirstHalf: 101,
    SecondHalf: 102,
    FirstHalfOvertime: 103,
    SecondHalfOvertime: 104,
    Penalties: 105,

    // Basket
    FirstQuarter: 201,
    SecondQuarter: 202,
    ThirdQuarter: 203,
    FourthQuarter: 204,
};

const IncidentBelong = {
    Neutral: 0,
    HomeTeam: 1,
    AwayTeam: 2
};

const IncidentType = {
    Unknown: 0,


    Start: 1,
    HalfTimeScore: 2,
    OvertimeIsOver: 3,
    End: 4,

    Football_Goal: 101,
    Football_GoalKick: 102,
    Football_OwnGoal: 103,

    Football_Penalty: 104,
    Football_PenaltyMissed: 105,
    Football_PenaltyKickEnded: 106,
    Football_PenaltyShootOut: 107,
    Football_PenaltyShootOutMissed: 108,

    Football_Substitution: 109,

    Football_YellowCard: 110,
    Football_RedCard: 111,
    Football_CardUpgradeConfirmed: 112,

    Football_VAR: 113,

    Football_Corner: 114,
    Football_Offside: 115,
    Football_FreeKick: 116,
    Football_Midfield: 117,
    Football_InjuryTime: 118,
    Football_ShotsOnTarget: 119,
    Football_ShotsOffTarget: 120,
    Football_Attacks: 121,
    Football_DangerousAttack: 122,
    Football_BallPossession: 123
};

const VARReason = new Map([
    [0, ""], // Other = 0,
    [1, "שער בבדיקה"], // GoalAwarded = 1,
    [2, "שער בבדיקה"], // GoalNotAwarded = 2,
    [3, "פנדל בבדיקה"], // PenaltyAwarded = 3,
    [4, "פנדל בבדיקה"], // PenaltyNotAwarded = 4,
    [5, "כרטיס אדום בבדיקה"], // RedCardGiven = 5,
    [6, "כרטיס אדום בבדיקה"], // CardUpgrade = 6,
    [7, ""]  // MistakenIdentity = 7
]);

const VARResult = new Map([
    [0, ""], // Unknown = 0,
    [1, "שער אושר"], // GoalConfirmed = 1,
    [2, "שער נפסל"], // GoalCancelled = 2,*
    [3, "פנדל אושר"], // PenaltyConfirmed = 3,
    [4, "פנדל בוטל"], // PenaltyCancelled = 4,*
    [5, "כרטיס אדום אושר"], // RedCardConfirmed = 5,
    [6, "כרטיס אדום בוטל"], // RedCardCancelled = 6,*
    [7, "כרטיס אדום אושר"], // CardUpgradeConfirmed = 7,
    [8, "כרטיס אדום בוטל"], // CardUpgradeCancelled = 8,*
    [9, ""], // OriginalDecision = 9,
    [10, ""] // DecisionChanged = 10
]);
*/
// production versions. 
(function ($) {

    window.BuildSportBar = function (sports) {

        if ($j("#sport-bar").hasClass("initiated"))
            return;

        $j("#sport-bar").addClass("initiated");

        if (Array.isArray(sports) && typeof sports.reverse === "function") {
            $j(sports.reverse()).each(function (i, obj) {

                if (obj.Type === "Soccer")
                    obj.Type = "Football";

                var navItemID = "switch-to-" + obj.Type.toString().toLowerCase()

                $j("#sport-bar").append(
                    $j("<a></a>")
                        .attr(
                            {
                                "id": navItemID
                            })
                        .html(obj.Name)
                        .on("click", function () {
                            ShowSportOnly(obj.Type);
                        })
                );

                if (config.Platform !== Platform.Desktop) {
                    $("#" + navItemID)
                        .prepend("<br />")
                        .css("width", "calc(100% / " + sports.length + " - 0.2rem)");
                }

                $j("#" + navItemID).prepend(
                    $j("<img />")
                        .attr(
                            {
                                "src": obj.IconOFF,
                                "id": "sport-bar-image-" + obj.Type.toString().toLowerCase(),
                                "data-image-on": obj.IconON,
                                "data-image-off": obj.IconOFF, "data-status": "off"
                            })
                );
            });
        }
    };

    window.ShowSportOnly = function (type) {
        
        $j("#is-live-switcher").data("sport-type", type.toString().toLowerCase());

        FilterShown();
    };

    window.FilterShown = function () {

        $j("#msg-no-live-matches").hide();

        var whatToShowSelectorLeague = ".league";
        var whatToShowSelectorMatch = ".match";

        var isLive = $j("#is-live-switcher").prop('checked');

        var type = $j("#is-live-switcher").data("sport-type").toString().toLowerCase();

        $j("#sport-bar a").css("color", "#96a8c3");
        $j("#sport-bar a img").each(function (i, obj) {
            if ($j(obj).attr("src") !== $j(obj).data("image-off")) {
                $j(obj).attr("src", $j(obj).data("image-off"));
            }
        });

        $j("#switch-to-" + type).css("color", "#fff");
        $j("#sport-bar-image-" + type).attr("src", $j("#sport-bar-image-" + type).data("image-on"));

        if (type !== "all") {
            whatToShowSelectorLeague += "." + type;
            whatToShowSelectorMatch += "." + type;
        }

        if (isLive)
            whatToShowSelectorMatch += ".live";

        var urlFiltered = new URL(document.location.href);
        urlFiltered.hash = whatToShowSelectorMatch;
        document.location.href = urlFiltered;

        $j("#live-games div.league, .match").hide();
        
        $j(whatToShowSelectorLeague).show();

        $j(whatToShowSelectorMatch).show();

        $j(".league").each(function (i, obj) {

            if ($j(obj).children("div.matches").children(":visible").length === 0)
                $j(obj).hide();
        });

        if ($j(whatToShowSelectorMatch + ":visible").length < 1)
            $j("#msg-no-live-matches").show();
    };









    window.BuildLive = function (jarrLeagues) {

        var tmplONELeague = document.querySelector("#tmpl-league-title");

        jQuery(jarrLeagues).each(function (i, league) {

            const uiLeagueTitleBar = tmplONELeague.content.cloneNode(true);

            var leagueContainerID = "league-" + league.DataSource + "-" + league.UniqueID;

            if (!$j("#" + leagueContainerID).length) {

                $j("#live-games").append($j("<div />")

                    .attr({
                        "id": leagueContainerID,
                        "data-source": league.DataSource
                    })
                    .addClass("league tv")
                    .addClass(leagueContainerID)
                    .addClass(league.SportTypeName.toLowerCase())
                    .addClass(league.SportTypeName.toLowerCase() === "soccer" ? "football" : "")
                );

                $j(uiLeagueTitleBar.querySelector("div.league-title div.name")).html(league.Name);

                $j("#" + leagueContainerID)
                    .append(uiLeagueTitleBar)
                    .append($j("<div />").addClass("matches"));

                var leagueindex = i + 1;

                if (config.Platform === Platform.Desktop && leagueindex === 3 && $j("#ad-after-league-" + leagueindex).length < 1) {
                    var tmplAd = document.querySelector("#tmpl-ad-after-league-" + leagueindex);
                    $j("#live-games").append(tmplAd.content.cloneNode(true));

                    if (window.OBR && OBR.extern)
                        OBR.extern.refreshWidget("https://www.one.co.il/Live/");
                }

            }

            $j(league.Matches).each(function (i, match) {

                let key = "match-" + match.IDLive + "-" + match.IDMatch;

                if (match.Home !== undefined && match.Away !== undefined)
                    key = "match-" + match.ID;

                let isMatchExistInUI = $j("#" + key).length > 0;

                if (!MATCHES_STATE.has(key))
                    MATCHES_STATE.set(key, match);

                const matchPrev = MATCHES_STATE.get(key);

                let isMatchUpdateRequired = IsMatchStatusChanged(match, matchPrev);
                
                MATCHES_STATE.set(key, match);

                if (isMatchExistInUI && !isMatchUpdateRequired)
                    return;

                if (isMatchExistInUI && match.IsStarted) {

                    if (match.IsLive && !$("#" + key).hasClass("live")) {
                        $("#" + key).addClass("live").show();
                        FilterShown();
                    }

                    if (!match.IsLive && $("#" + key).hasClass("live")) {
                        $("#" + key).removeClass("live").show();
                        FilterShown();
                    }

                    MatchUIRealTimeUpdatehBrief(match);

                    return;
                }

                var game = null;

                if (league.DataSource === "ONE")
                    game = GetMatchUI(match, false);

                $j(game.querySelector(".match"))
                    .attr({
                        "id": key
                    });

                if (isMatchExistInUI) {

                    $j("#" + key).replaceWith(game);
                }
                else {
                    $j("#" + leagueContainerID + " div.matches").append(game);
                }
            });

            FilterShown();
            
        });

    };


    



    window.GetMatchUI = function (match, isFull) {

        match.Home.Score.Match ??= match.Home.Score.RegularTime;
        match.Away.Score.Match ??= match.Away.Score.RegularTime;

        match.Home.Score.Penalty ??= match.Home.Score.Penalty;
        match.Away.Score.Penalty ??= match.Away.Score.Penalty;

        var tmpl = document.querySelector(isFull ? '#tmpl-match-header-general' : "#tmpl-match-brief");

        let game = tmpl.content.cloneNode(true);

        var container = game.querySelector(isFull ? ".header" : ".brief");

        var classes = "";

        switch (match.SportType) {
            case config.Enums.Leagues.Sport.Types.Soccer.ID:
                classes = "football football-model-3";
                break;
            case config.Enums.Leagues.Sport.Types.Basketball.ID:
                classes = "basketball basketball-model-3";
                break;
            case config.Enums.Leagues.Sport.Types.Tennis.ID:
                classes = "tennis tennis-model-3";
                break;
        }

        $(game.querySelector(".match")).addClass(classes);

        if (match.IsLive) {
            $(game.querySelector(".match")).addClass("live");
        }

        $(container).attr("href", GetURLFromModel(match.URL));

        $(game.querySelector(".time")).html(dateFormat(new Date(match.DateStart), "HH:MM") === "11:11" ? "" : dateFormat(new Date(match.DateStart), "HH:MM"));

        if (match.State === config.Enums.Leagues.Match.States.Delay || match.State === config.Enums.Leagues.Match.States.Cancel)
            $(game.querySelector(".time")).html(match.TextStates.State);

        if (match.TVChannel !== null) {
            $(game.querySelector(".football")).addClass("tv");
            $(game.querySelector(".time")).append($("<div></div")
                .addClass("tv-channel-name")
                .html(match.TVChannel.Name.Main));
        }

        $j(game.querySelectorAll(".home div.name")).html(match.Home.Name.Main);
        $j(game.querySelectorAll(".away div.name")).html(match.Away.Name.Main);

        /*
        $j(game.querySelectorAll(".home img.logo,.away img.logo"))
            .attr("src", spacerUrl)
            .addClass("logo");
        */
        
        if (match.SportType === config.Enums.Leagues.Sport.Types.Tennis.ID) {

            // check how many players provided in tennis "squad"
            var numberOfParticipants = Math.max(match.Home.Squad?.length ?? 0, match.Away.Squad?.length ?? 0);

            var $homePartraits = TennisGetPortraits(match.Home.Squad, numberOfParticipants);
            if ($homePartraits !== null)
                $(game.querySelectorAll(".home a img.logo, .home img.logo"))
                    .replaceWith($homePartraits);
            
            var $awayPartraits = TennisGetPortraits(match.Away.Squad, numberOfParticipants);
            if ($awayPartraits !== null)
                $(game.querySelectorAll(".away a img.logo, .away img.logo"))
                    .replaceWith($awayPartraits);
        }
        else {

            if (errorLogos.indexOf(match.Home.ID.toString()) < 0)
                $(game.querySelectorAll(".home img.logo"))
                    .attr("src", match.Home.Image.URL)
                    .attr("onerror", "javascript:NoLogo('" + match.Home.ID + "');$j(this).css('visibility','hidden');");

            if (errorLogos.indexOf(match.Away.ID.toString()) < 0)
                $(game.querySelectorAll(".away img.logo"))
                    .attr("src", match.Away.Image.URL)
                    .attr("onerror", "javascript:NoLogo('" + match.Away.ID + "');$j(this).css('visibility','hidden');");
        }


        if (match.IsStarted && match.Home.Score.Match > -1) {

            $(game.querySelector(".home div.score")).html(match.Home.Score.Match + (match.Home.Score.Penalty > 0 ? `(${match.Home.Score.Penalty})` : ""));
            $(game.querySelector(".away div.score")).html(match.Away.Score.Match + (match.Away.Score.Penalty > 0 ? `(${match.Away.Score.Penalty})` : ""));

            // bolding winner
            if (match.State === config.Enums.Leagues.Match.States.Ended) // ended
            {
                if (match.Home.Score.Match + (match.Home.Score.Penalty > 0 ? match.Home.Score.Penalty : 0) > match.Away.Score.Match + (match.Away.Score.Penalty > 0 ? match.Away.Score.Penalty : 0))
                    $(game.querySelector("a.brief div.home")).addClass("winner");
                else
                    if (match.Away.Score.Match + (match.Away.Score.Penalty > 0 ? match.Away.Score.Penalty : 0) > match.Home.Score.Match + (match.Home.Score.Penalty > 0 ? match.Home.Score.Penalty : 0))
                        $(game.querySelector("a.brief div.away")).addClass("winner");
            }
        }

        if (match.SportType === config.Enums.Leagues.Sport.Types.Soccer.ID) {
            game = AddRedCardsIndicatorToBriefUI(match, game);

            if (isFull) {
                game = AddRelatedMatchData(match, game);
            }
        }

        if (!isFull && !match.IsStarted && match.Meta.WinnerSendForm !== undefined) {

            if (config.Platform === Platform.Desktop) {
                $(game.querySelector("div.state")).append(
                    $("<a></a>")
                        .attr("href", match.Meta.WinnerSendForm.URL)
                        .html(match.Meta.WinnerSendForm.Text)
                );
            }

            if (config.Platform === Platform.Application) {
                $(game.querySelector("div.state")).append(
                    $("<a></a>")
                        .attr("href", match.Meta.WinnerSendForm.URL)
                        .append($("<img />")
                            .attr("src", match.Meta.WinnerSendForm.Image)
                            .css("width", "85%")
                        )
                );
            }
        }
        else
        {
            switch (match.SportType) {
                case config.Enums.Leagues.Sport.Types.Soccer.ID:

                    if (match.State !== config.Enums.Leagues.Match.States.Delay && match.State !== config.Enums.Leagues.Match.States.Cancel)
                        $(game.querySelector("div.state")).html(match.TextStates.State);
                    else
                        $(game.querySelector("div.state")).html("");
                    break;

                case config.Enums.Leagues.Sport.Types.Basketball.ID:
                    $(game.querySelector("div.state")).html(match.TextStates.State + (match.IsLive ? "<br />" + match.TextStates.MinutesLive : ""));
                    break;

                case config.Enums.Leagues.Sport.Types.Tennis.ID:
                    $(game.querySelector("div.state")).html(match.TextStates.State);
                    break;
            }
        }

        if (match.DataProvider !== 0) {
            if (!IsNullOrUndefined(match.Meta.TheSports) && !IsNullOrUndefined(match.Meta.TheSports.ID)) {
                $(game.querySelector(".match")).addClass("the-" + match.Meta.TheSports.ID);
                $(game.querySelector(".brief div.teams")).css("border-right-style", "dotted");
            }
        }

        return game;
    };




    window.AddDetailsToHeader = function (match, ui) {

        switch (match.SportType) {
            case config.Enums.Leagues.Sport.Types.Soccer.ID:
            case config.Enums.Leagues.Sport.Types.Basketball.ID:
                $(ui.querySelector(".league a.name")).attr("href", GetURLFromModel(match.League.URL));
                break;
            case config.Enums.Leagues.Sport.Types.Tennis.ID:
                break;
        }


        $(ui.querySelector(".league a.name span")).text(match.League.Name.Main);

        if (match.League.Image.URL !== undefined && match.League.Image.URL !== "")
            $(ui.querySelector(".league a.name img"))
                .attr("src", match.League.Image.URL)
                .removeClass("hide");

        var details = GetHebrewDayName(dateFormat(new Date(match.DateStart), "dddd")) + ", " + dateFormat(new Date(match.DateStart), "dd/mm/yyyy");

        if (match.TVChannel !== null) {
            details += " | " + match.TVChannel.Name.Main;
        }

        var stadium = GetStadium(match);
        if (!IsNullOrEmpty(stadium))
            details += "<br />" + stadium;

        var weather = GetWeather(match);
        if (!IsNullOrEmpty(weather))
            details += "<br />" + weather;

        $(ui.querySelector("div.match-details")).html(details);

        if (!match.IsStarted) {
            $(ui.querySelector(".header-general.full .header .state-score .score")).html(dateFormat(new Date(match.DateStart), "HH:MM") === "11:11" ? "" : dateFormat(new Date(match.DateStart), "HH:MM"));

            if (match.State === config.Enums.Leagues.Match.States.Delay || match.State === config.Enums.Leagues.Match.States.Cancel)
                $(ui.querySelector(".header-general.full .header .state-score .score")).html(match.TextStates.State);
        }
        else {
            $(ui.querySelector(".header-general.full .header .state-score .score")).html(match.Home.Score.Match + " - " + match.Away.Score.Match);

            if (match.Home.Score.HalfTime > -1 && match.Away.Score.HalfTime > -1)
                $(ui.querySelector(".header-general.full .header .state-score .half-time")).html(`(מחצית ${match.Home.Score.HalfTime} - ${match.Away.Score.HalfTime})`);
        }

        //ui = AddRelatedMatchData(match, ui);

        if (match.Meta !== undefined && match.Meta.ONE != undefined && match.Meta.ONE.PenaltyNote !== undefined) {
            $(ui.querySelector(".header")).append($("<div></div>").addClass("penalty-note").html(match.Meta.ONE.PenaltyNote));
        }

        return ui;
    };


    window.UpdateLive = function (jarrMatches) {

        jQuery(jarrMatches).each(function (i, match) {
            MatchUIRealTimeUpdatehBrief(match);
        });
    };

    window.MatchUIRealTimeUpdatehBrief = function (match) {

        match.Home.Score.Match ??= match.Home.Score.RegularTime;
        match.Away.Score.Match ??= match.Away.Score.RegularTime;

        if (match.State !== config.Enums.Leagues.Match.States.Delay && match.State !== config.Enums.Leagues.Match.States.Cancel)
            $("#match-" + match.ID + " .brief .state").html(match.TextStates.State);

        if (match.SportType === config.Enums.Leagues.Sport.Types.Basketball.ID && match.IsLive)
            $("#match-" + match.ID + " .brief .state").append("<br />" + match.TextStates.MinutesLive);

        $("#match-" + match.ID + " .teams .home .score").html(match.Home.Score.Match);
        $("#match-" + match.ID + " .teams .away .score").html(match.Away.Score.Match);
    }

    window.MatchUIRealTimeUpdateFull = function (match) {

        switch (match.SportType) {
            case config.Enums.Leagues.Sport.Types.Soccer.ID:
                SoccerRealTimeUpdateMatchFull(match);
                break;
            case config.Enums.Leagues.Sport.Types.Basketball.ID:
                BasketballRealTimeUpdateMatchFull(match);
                break;
            case config.Enums.Leagues.Sport.Types.Tennis.ID:
                TennisRealTimeUpdateMatchFull(match);
                break;
        }
    }




    window.AddDataTabsToMatchView = function (tabsData) {

        $(tabsData).each(function (i, obj) {
            $("#match-tabs").append(
                $("<div></div")
                    .html(obj.Title)
                    .addClass("match-tab")
                    .attr({
                        "id": "match-tab-" + obj.ID
                    })
                    .on("click", function () {
                        ShowDataTabOfMatch(obj.ID);
                    })
            );
        });

        $("#match-tab-main").addClass("active");
        $(".match-data-main").show();
    };

    window.ShowDataTabOfMatch = function (name) {

        if (name.toLowerCase() === "standing")
            AddStanding(match);

        if (name.toLowerCase() === "statistic")
            AddStatistics(match);

        if (name.toLowerCase() === "boxscore")
            AddStatistics(match);

        $(".match-tab").removeClass("active");
        $("#match-tab-" + name).addClass("active");

        $(".match-data").hide();
        $(".match-data-" + name).show();
    };

})(jQuery);
(function ($) {

    window.AddStanding = function (match) {

        $(".data-preloader").show();

        jQuery.get(config.API.URL + "/League/" + match.League.ID + "/Standing/",
            {
            }
        ).always(function (data) {

            $(".standing").hide();
            $(".data-preloader").show();

            $(".standing").html("");

            if (data.Data === undefined) {
                $("#match-tab-standing").hide();
                return;
            }

            $(".standing-header span").html(match.League.Name.Main);
            $(".standing-header img").attr("src", match.League.Image.URL);

            var tmplGroup = document.querySelector("#tmpl-match-standing-group-header");
            var tmplTeam = document.querySelector("#tmpl-match-standing-team");

            $(data.Data.Tables).each(function (t, table) {

                if (!table.IsCurrent || !table.IsShow)
                    return;

                $(table.Groups).each(function (g, group) {

                    if (group.ID > 0) {

                        let ui = tmplGroup.content.cloneNode(true);

                        $(ui.querySelector(".name")).html(group.Name.Main);

                        $(".standing").append(ui);
                    }


                    let ui = tmplTeam.content.cloneNode(true);
                    $(ui.querySelector(".team")).addClass("header");
                    $(ui.querySelector(".team .name")).html("קבוצה");

                    $(ui.querySelector(".team .realtime")).html("");
                    $(ui.querySelector(".team .matches")).html("מש'");
                    $(ui.querySelector(".team .won")).html("נצ'");
                    $(ui.querySelector(".team .draw")).html("ת'");
                    $(ui.querySelector(".team .loss")).html("הפ'");
                    $(ui.querySelector(".team .ratio")).html("יחס");
                    $(ui.querySelector(".team .points")).html("נק'");
                    $(ui.querySelector(".team .success")).html("%");

                    if (match.SportType === config.Enums.Leagues.Sport.Types.Basketball.ID)
                        $(ui.querySelector(".team .ratio")).html("הפרש סלים");

                    $(ui.querySelectorAll(".team .football, .team .basketball")).css("display", "none");

                    switch (match.SportType) {
                        case config.Enums.Leagues.Sport.Types.Soccer.ID:
                            $(ui.querySelectorAll(".team .football")).css("display", "flex");
                            break;
                        case config.Enums.Leagues.Sport.Types.Basketball.ID:
                            $(ui.querySelectorAll(".team .basketball")).css("display", "flex");
                            break;
                    }

                    $(".standing").append(ui);


                    $(group.Teams).each(function (t, team) {

                        let ui = tmplTeam.content.cloneNode(true);

                        $(ui.querySelectorAll(".team .football, .team .basketball")).css("display", "none");

                        switch (match.SportType) {
                            case config.Enums.Leagues.Sport.Types.Soccer.ID:
                                $(ui.querySelectorAll(".team .football")).css("display", "flex");
                                break;
                            case config.Enums.Leagues.Sport.Types.Basketball.ID:
                                $(ui.querySelectorAll(".team .basketball")).css("display", "flex");
                                break;
                        }

                        let id = `standing-one-${team.ID}`;
                        /*
                        $(ui.querySelector(".team"))
                            .attr({
                                "id": id,
                                "href": GetURLFromModel(team.URL)
                            });
                        */
                        if (team.ID === match.Home.ID || team.ID === match.Away.ID)
                            $(ui.querySelector(".team")).addClass("of-this-match");

                        

                        $(ui.querySelector(".team .position")).html(team.Main.Position);
                        $(ui.querySelector(".team img.logo")).attr("src", team.Image.URL);
                        $(ui.querySelector(".team .name")).html(team.Name.Main);

                        $(ui.querySelector(".team .matches")).html(team.Main.Matches);
                        $(ui.querySelector(".team .won")).html(team.Main.Won);
                        $(ui.querySelector(".team .draw")).html(team.Main.Draw);
                        $(ui.querySelector(".team .loss")).html(team.Main.Loss);
                        $(ui.querySelector(".team .ratio")).html(team.Main.GoalsAgainst + " - " + team.Main.Goals);
                        $(ui.querySelector(".team .points")).html(team.Main.Points);
                        $(ui.querySelector(".team .success")).html(team.Main.Success + "%");

                        logone("Live: " + team.LiveGoals + "-" + team.LiveGoalsAgainst);

                        team.LiveGoals = parseInt(team.LiveGoals, 10);
                        team.LiveGoalsAgainst = parseInt(team.LiveGoalsAgainst, 10);

                        if (team.LiveGoals > -1 && team.LiveGoalsAgainst > -1) {

                            var cssclass = "standing-realtime-teko";

                            if (team.LiveGoals > team.LiveGoalsAgainst)
                                cssclass = "standing-realtime-won";

                            if (team.LiveGoals < team.LiveGoalsAgainst)
                                cssclass = "standing-realtime-loss";

                            $(ui.querySelector(".team .realtime")).html(`<span class="${cssclass}">${team.LiveGoals} - ${team.LiveGoalsAgainst}</span>`);
                        }

                        if (match.SportType === config.Enums.Leagues.Sport.Types.Basketball.ID) {
                            {
                                const sign = parseInt(team.Main.GoalDifference, 10) < 0 ? "" : "+";
                                $(ui.querySelector(".team .ratio")).html(sign + team.Main.GoalDifference);
                            }
                        }

                        if ($("#" + id).length > 0)
                            $("#" + id).replaceWith(ui);
                        else
                            $(".standing").append(ui);
                    });
                });
            });

            $(".data-preloader").hide();
            $(".standing").show();
            

        });
    };

})(jQuery);
(function ($) {

    window.AddStatistics = function (match) {

        if (match.DataURLs.Statistics === null || match.DataURLs.Statistics === undefined)
            return;

        $(".match-stats").hide();
        $(".data-preloader").show();

        $(".match-stats div.teams .home").attr("href", GetURLFromModel(match.Home.URL));
        $(".match-stats div.teams .away").attr("href", GetURLFromModel(match.Away.URL));

        $(".match-stats div.teams .home .name").html(match.Home.Name.Main);
        $(".match-stats div.teams .away .name").html(match.Away.Name.Main);

        $(".match-stats div.teams .home img.logo").attr("src", match.Home.Image.URL);
        $(".match-stats div.teams .away img.logo").attr("src", match.Away.Image.URL);

        var url = match.DataURLs.Statistics.API;

        //url = url.replace("https://api.", "http://evgeny.sites.");

        jQuery.get(url,
            {
            }
        ).always(function (data) {

            const mapStat = new Map();

            // Collect Stat groups by sport type
            switch (match.SportType) {
                case config.Enums.Leagues.Sport.Types.Soccer.ID:
                    mapStat.set(config.Enums.Leagues.Statistics.Groups.General, new Map());
                    mapStat.set(config.Enums.Leagues.Statistics.Groups.Football_Attack, new Map());
                    mapStat.set(config.Enums.Leagues.Statistics.Groups.Football_AttackOnGoal, new Map());
                    mapStat.set(config.Enums.Leagues.Statistics.Groups.Football_Defend, new Map());
                    mapStat.set(config.Enums.Leagues.Statistics.Groups.Football_GoalKeeper, new Map());
                    break;

                case config.Enums.Leagues.Sport.Types.Basketball.ID:
                    mapStat.set(config.Enums.Leagues.Statistics.Groups.General, new Map());
                    mapStat.set(config.Enums.Leagues.Statistics.Groups.Basketball_Attack, new Map());
                    mapStat.set(config.Enums.Leagues.Statistics.Groups.Basketball_Defend, new Map());

                    if (data.Data.Statistics.Home.Players.length > 0)
                        BoxScore(data.Data.Statistics);
                    break;
            }

            

            var tmplMatchStat = document.querySelector('#tmpl-match-stat-item');
            $(".match-stats .stat-data").html("");

            // now iterate over all collected groups
            for (const [key, value] of mapStat) {

                $(".match-stats .stat-data").append(
                    $("<div />")
                        .attr("id", "stat-group-title-" + key.ID)
                        .html(key.Description.Name.Main)
                        .css(
                        {
                            "display": "none",
                            "width": "100%",
                            "text-align": "center",
                            "font-weight": "bold",
                            "font-size": "3rem",
                            "margin": "3rem 0 0 0",
                            "text-decoration": "underline"
                            //"border-bottom": "solid 0.1rem black"
                        })
                );

                $(data.Data.Statistics.Home.Stat).each(function (i, home) {

                    
                    if (home.Group === key.ID) {

                        $("#stat-group-title-" + key.ID).show();

                        var away = data.Data.Statistics.Away.Stat[i];

                        var statItem = tmplMatchStat.content.cloneNode(true);

                        var percentHome = parseInt(home.ValueCalculated / (home.ValueCalculated + away.ValueCalculated) * 100, 10);
                        var percentAway = parseInt(100 - percentHome);

                        // Possessions - החזקה בכדור
                        if (home.Type === config.Enums.Leagues.Statistics.Types.Football_BallPossession.ID) {
                            StatCircleChart(percentHome, percentAway, home.Title);
                        }
                        else {

                            statItem.querySelector(".val-home").innerHTML = home.ValueToDisplay.indexOf("%") > -1 ? home.ValueToDisplay : home.Value; //+ " - " + percentHome.toFixed() + "%";
                            statItem.querySelector(".val-away").innerHTML = away.ValueToDisplay.indexOf("%") > -1 ? away.ValueToDisplay : away.Value; // + " - " + percentGuest.toFixed() + "%";

                            statItem.querySelector(".val-title").innerHTML = home.Title;

                            if (home.ValueCalculated > away.ValueCalculated)
                                statItem.querySelector(".val-home").style['font-weight'] = "bold";
                            if (away.ValueCalculated > home.ValueCalculated)
                                statItem.querySelector(".val-away").style['font-weight'] = "bold";

                            $j(statItem.querySelector(".bar-home")).css(
                                {
                                    "width": (percentHome / 2) + "%",
                                    "left": "50%"
                                }
                            );

                            $j(statItem.querySelector(".bar-away")).css(
                                {
                                    "width": (percentAway / 2) + "%",
                                    "right": "50%",
                                }
                            );

                            $(".match-stats .stat-data").append(statItem);
                        }
                    }
                });
            }

            $(".data-preloader").hide();
            $(".match-stats").show();
            

            
        });

    };

    window.StatCircleChart = function (valHome, valAway, title) {

        var idCircleChart = ".circle-chart";
        var idCircleChartTeamHome = idCircleChart + " circle.circle-chart-team-home";
        var idCircleChartTeamAway = idCircleChart + " circle.circle-chart-team-away";

        var radius = 75; 
        var percentage = valHome;
        var circumference = 2 * 3.14 * radius;
        var graphPercentage = circumference / 100 * percentage;

        $j(idCircleChartTeamHome).css("stroke-dasharray", graphPercentage + "," + circumference);

        $j(".match-stats div.chart div.title").html(title);
        $j(".match-stats div.chart div.value-team-home").html(valHome + "%");
        $j(".match-stats div.chart div.value-team-away").html(valAway + "%");

        $j(".circle-chart-container").show();
    };

    window.BoxScore = function (stats) {

        var bsHome = GetBoxScoreTable(stats.Home.Players);

        if (IsNullOrUndefined(bsHome))
            return;

        bsHome.querySelector("div.box-score-team").setAttributes({ "id": "box-score-home" });

        var bsAway = GetBoxScoreTable(stats.Away.Players);
        bsAway.querySelector("div.box-score-team").setAttributes({ "id": "box-score-away" });
        
        document.getElementById("box-score-container").textContent = "";
        document.getElementById("box-score-container").appendChild(bsHome);
        document.getElementById("box-score-container").appendChild(bsAway);


        if (document.querySelector("#box-score-home-select span").textContent === "") {

            document.querySelector("#box-score-home-select span").textContent = stats.Home.Team.Name.Main;
            document.querySelector("#box-score-home-select img").setAttribute("src",  stats.Home.Team.Image.PC);

            document.querySelector("#box-score-away-select span").textContent = stats.Away.Team.Name.Main;
            document.querySelector("#box-score-away-select img").setAttribute("src", stats.Away.Team.Image.PC);

            document.getElementById("box-score-home-select").addEventListener("click", function () {
                document.getElementById("box-score-home").style.display = "flex";
                document.getElementById("box-score-away").style.display = "none";

                document.getElementById("box-score-home-select").classList.add("active");
                document.getElementById("box-score-away-select").classList.remove("active");
            });

            document.getElementById("box-score-away-select").addEventListener("click", function () {
                document.getElementById("box-score-home").style.display = "none";
                document.getElementById("box-score-away").style.display = "flex";

                document.getElementById("box-score-home-select").classList.remove("active");
                document.getElementById("box-score-away-select").classList.add("active");
            });

            
        }

        document.getElementById("box-score-home").style.display = "flex";
        document.getElementById("box-score-away").style.display = "none";
        document.getElementById("box-score-home-select").classList.add("active");
    };


    function GetBoxScoreTable(players)
    {
        var tmplBoxScore = document.querySelector("#tmpl-team-box-score");

        if (IsNullOrUndefined(tmplBoxScore))
            return null;

        const teamBoxScore = tmplBoxScore.content.cloneNode(true);

        const statsHeader = teamBoxScore.querySelector(".box-score-stats-header");
        const statsContent = teamBoxScore.querySelector(".box-score-stats-content");
        const playersContainer = teamBoxScore.querySelector(".box-score-players");

        // Очистка контейнеров
        statsHeader.innerHTML = "";
        statsContent.innerHTML = "";
        playersContainer.innerHTML = "";

        // Добавляем заголовок для списка игроков
        const playerHeader = document.createElement("div");
        playerHeader.classList.add("box-score-stats-header");

        const playerHeaderRow = document.createElement("div");
        playerHeaderRow.classList.add("box-score-row");

        const playerHeaderCell = document.createElement("div");
        playerHeaderCell.classList.add("box-score-cell");
        playerHeaderCell.classList.add("box-score-player-name");
        
        playerHeaderCell.textContent = "שם שחקן";
        playerHeaderRow.appendChild(playerHeaderCell);
        playerHeader.appendChild(playerHeaderRow);
        playersContainer.appendChild(playerHeader);

        // Сортируем игроков по имени
        //players.sort((a, b) => a.Player.Name.Main.localeCompare(b.Player.Name.Main));

        players.sort((a, b) => {
            const aPoints = a.Stat.find(stat => stat.Type === 248) ?.Value || 0;
            const bPoints = b.Stat.find(stat => stat.Type === 248) ?.Value || 0;
            return bPoints - aPoints;
        });


        // Собираем уникальные типы статистики, сортируем по Order
        let statColumns = [];

        players.forEach(player => {
            player.Stat.forEach(stat => {
                if (!statColumns.find(col => col.Type === stat.Type)) {
                    statColumns.push({
                        Type: stat.Type,
                        Title: stat.Title,
                        Order: stat.Order
                    });
                }
            });
        });

        // Фильтруем только столбцы, у которых хотя бы одно значение НЕ 0
        statColumns = statColumns
            .sort((a, b) => a.Order - b.Order) // Сортируем по Order
            .filter(col => players.some(player =>
                player.Stat.some(stat => stat.Type === col.Type && stat.Value !== 0)
            ));

        if (statColumns.length === 0) {
            statsContent.innerHTML = "<p>אין נתונים</p>";
            return;
        }

        // Создаем заголовок строкой
        const headerRow = document.createElement("div");
        headerRow.classList.add("box-score-row");

        statColumns.forEach(col => {
            const headerCell = document.createElement("div");
            headerCell.classList.add("box-score-cell");
            headerCell.textContent = col.Title;
            headerRow.appendChild(headerCell);
        });

        statsHeader.appendChild(headerRow);

        // Добавляем игроков и их статистику
        players.forEach(player => {
            const row = document.createElement("div");
            row.classList.add("box-score-row");

            const playerNameRow = document.createElement("div");
            playerNameRow.classList.add("box-score-row");

            const playerCell = document.createElement("div");
            playerCell.classList.add("box-score-cell");
            playerCell.classList.add("box-score-player-name");

            const playerName = document.createElement("span");
            playerName.textContent = player.Player.Name.Main;

            const playerImage = document.createElement("img");
            playerImage.setAttribute("src", player.Player.Image.PC);

            playerCell.appendChild(playerImage);
            playerCell.appendChild(playerName);

            playerNameRow.appendChild(playerCell);
            playersContainer.appendChild(playerNameRow);


            // Заполняем данные статистики
            statColumns.forEach(col => {
                const statDiv = document.createElement("div");
                statDiv.classList.add("box-score-cell");
                const stat = player.Stat.find(s => s.Type === col.Type);
                statDiv.textContent = stat ? stat.ValueToDisplay : "-";
                row.appendChild(statDiv);
            });

            statsContent.appendChild(row);
        });

        // Настройка ширины колонок (чтобы align работал корректно)
        statsHeader.style.width = `100%`;

        return teamBoxScore;
    }
















    function GetBoxScoreTable1(players) {

        var tmplPlayersStatsTable = document.querySelector("#tmpl-box-score-table");

        if (IsNullOrUndefined(tmplPlayersStatsTable))
            return null;

        const tblStats = tmplPlayersStatsTable.content.cloneNode(true);

        const headerRow = tblStats.querySelector(".box-score-table-header");
        const tbody = tblStats.querySelector(".box-score-table-body");

        // Сортируем игроков по имени
        players.sort((a, b) => a.Player.Name.Main.localeCompare(b.Player.Name.Main));


        // Собираем уникальные типы статистики и сортируем по Order
        let statColumns = [];

        players.forEach(player => {
            player.Stat.forEach(stat => {
                if (!statColumns.find(col => col.Type === stat.Type)) {
                    statColumns.push({
                        Type: stat.Type,
                        Title: stat.Title,
                        Order: stat.Order
                    });
                }
            });
        });

        // Фильтруем только те столбцы, у которых хотя бы одно значение НЕ 0
        statColumns = statColumns
            .sort((a, b) => a.Order - b.Order) // Сортируем по Order
            .filter(col => players.some(player =>
                player.Stat.some(stat => stat.Type === col.Type && stat.Value !== 0)
            ));

        if (statColumns.length === 0) {
            document.querySelector(".table-container").innerHTML = "<p>Нет доступных данных для отображения.</p>";
            return;
        }

        // Добавляем заголовки
        statColumns.forEach(col => {
            const th = document.createElement("th");
            th.textContent = col.Title;
            headerRow.appendChild(th);
        });

        // Заполняем строки данными игроков
        players.forEach(player => {
            const dataRow = document.createElement("tr");

            // Ячейка с именем игрока (фиксированная)
            const playerCell = document.createElement("td");
            playerCell.classList.add("fixed-column");

            const playerName = document.createElement("span");
            playerName.textContent = player.Player.Name.Main;

            const playerImage = document.createElement("img");
            playerImage.setAttribute("src", player.Player.Image.PC);

            playerCell.appendChild(playerImage);
            playerCell.appendChild(playerName);

            //playerCell.textContent = player.Player.Name.Main;
            dataRow.appendChild(playerCell);

            // Добавляем ячейки статистики в порядке `Order`
            statColumns.forEach(col => {
                const td = document.createElement("td");
                const stat = player.Stat.find(s => s.Type === col.Type);
                td.textContent = stat ? stat.ValueToDisplay : "-";
                dataRow.appendChild(td);
            });

            tbody.appendChild(dataRow);

        // Собираем уникальные типы статистики, исключая пустые
        /*
        let statMap = new Map();

        players.forEach(player => {
            player.Stat.forEach(stat => {
                if (!statMap.has(stat.Title)) {
                    statMap.set(stat.Title, []);
                }
                statMap.get(stat.Title).push(stat.Value);
            });
        });

        // Фильтруем только те столбцы, у которых хотя бы одно значение НЕ 0
        let validColumns = Array.from(statMap.entries())
            .filter(([title, values]) => values.some(value => value !== 0))
            .map(([title]) => title);

        if (validColumns.length === 0) {
            document.querySelector(".table-container").innerHTML = "<p>Нет доступных данных для отображения.</p>";
            return;
        }

        // Добавляем заголовки
        validColumns.forEach(title => {
            const th = document.createElement("th");
            th.textContent = title;
            headerRow.appendChild(th);
        });

        // Заполняем строки данными игроков
        players.forEach(player => {
            const dataRow = document.createElement("tr");

            // Ячейка с именем игрока (фиксированная)
            const playerCell = document.createElement("td");
            playerCell.classList.add("fixed-column");
            playerCell.textContent = player.Player.Name.Main;
            dataRow.appendChild(playerCell);

            validColumns.forEach(title => {
                const td = document.createElement("td");
                const stat = player.Stat.find(s => s.Title === title);
                td.textContent = stat ? stat.ValueToDisplay : "-";
                dataRow.appendChild(td);
            });

            tbody.appendChild(dataRow);
            */
        });

        return tblStats;
    }



    // display all data table
    window.PlayersStat1 = function(stats) {

        const container = document.getElementById("players-stats-container");

        var players = stats.Players;

        // Сортируем игроков по имени
        players.sort((a, b) => a.Player.Name.Main.localeCompare(b.Player.Name.Main));

        // Собираем уникальные заголовки статистики
        let headers = new Set();
        players.forEach(player => {
            player.Stat.forEach(stat => headers.add(stat.Title));
        });

        const headersArray = Array.from(headers);

        // Создаем таблицу
        const table = document.createElement("table");
        const thead = document.createElement("thead");
        const tbody = document.createElement("tbody");

        // Заголовок таблицы
        const headerRow = document.createElement("tr");
        const playerHeader = document.createElement("th");
        playerHeader.textContent = "";
        headerRow.appendChild(playerHeader);

        headersArray.forEach(title => {
            const th = document.createElement("th");
            th.textContent = title;
            headerRow.appendChild(th);
        });

        thead.appendChild(headerRow);
        table.appendChild(thead);

        // Заполняем строки данными игроков
        players.forEach(player => {
            const dataRow = document.createElement("tr");
            const playerCell = document.createElement("td");
            playerCell.textContent = player.Player.Name.Short;
            dataRow.appendChild(playerCell);

            headersArray.forEach(title => {
                const td = document.createElement("td");
                const stat = player.Stat.find(s => s.Title === title);
                td.textContent = stat ? stat.ValueToDisplay : "-";
                dataRow.appendChild(td);
            });

            tbody.appendChild(dataRow);
        });

        
        table.appendChild(tbody);


        return table;
    };

})(jQuery);
(function ($) {

    var totalNumberOfMatchIncidents = -1;

    window.AddRedCardsIndicatorToBriefUI = function (match, game) {

        if (match.Home.Score.RedCards > 0) {
            $(game.querySelectorAll(".brief div.home div.name"))
                .append($j("<img />")
                    .attr("src", "https://images.one.co.il/images/msites/2023/11/05/fcce39fd8cb7b520b6b52431dde554d7.jpg")
                    .css(
                        {
                            "width": "1.3rem",
                            "margin-right": "0.5rem"
                        })
                );

            if (match.Home.Score.RedCards > 1) {
                $(game.querySelectorAll("a.brief div.home div.name"))
                    .append($("<span></span>")
                        .html(match.Home.Score.RedCards + "x")
                        .css("font-size", "1.3rem"));
            }
        }

        if (match.Away.Score.RedCards > 0) {
            $(game.querySelectorAll("a.brief div.away div.name"))
                .append($("<img />")
                    .attr("src", "https://images.one.co.il/images/msites/2023/11/05/fcce39fd8cb7b520b6b52431dde554d7.jpg")
                    .css(
                        {
                            "width": "1.3rem",
                            "margin-right": "0.5rem"
                        })
                );

            if (match.Away.Score.RedCards > 1) {
                $(game.querySelector("a.brief div.away div.name"))
                    .append($("<span></span>")
                        .text(match.Away.Score.RedCards + "x")
                        .css("font-size", "1.3rem"));
            }
        }

        return game;
    };

    

    window.SoccerRealTimeUpdateMatchFull = function (match) {
        //logone("Update " + match.TextStates.State);

        match.Home.Score.Match ??= match.Home.Score.RegularTime;
        match.Away.Score.Match ??= match.Away.Score.RegularTime;

        if (match.State !== config.Enums.Leagues.Match.States.Delay && match.State !== config.Enums.Leagues.Match.States.Cancel)
            $("div.state").html(match.TextStates.State);

        if (match.IsStarted) {
            $(".football.full .header .state-score .score").html(match.Home.Score.Match + " - " + match.Away.Score.Match);

            if (match.Home.Score.HalfTime > -1 && match.Away.Score.HalfTime > -1)
                $(".football.full .header .state-score .half-time").html(`(מחצית ${match.Home.Score.HalfTime} - ${match.Away.Score.HalfTime})`);

            if (!IsNullOrUndefined(match.RelatedMatch)) {

                var aggMessage = 'סה"כ: ' + match.Home.Score.Agg + " - " + match.Away.Score.Agg;

                $(".agg-score").html(aggMessage);

                $(".football.full .related-match .agg-result .data .score").html(match.Home.Score.Agg + " - " + match.Away.Score.Agg);

            }
        }

        AddHightlightEvents(match);
    };

    

    






    // private
    AddRelatedMatchData = function (match, ui) {

        if (IsNullOrUndefined(match.RelatedMatch)) {
            return ui;
        }

        $(ui.querySelector(".football.full .related-match-data")).addClass("related-match").removeClass("hide");
        var aggMessage = 'סה"כ: ' + match.Home.Score.Agg + " - " + match.Away.Score.Agg;

        $(ui.querySelector(".agg-score")).html(aggMessage);

        $(ui.querySelectorAll(".football.full .related-match .result .data img.home")).attr("src", match.Home.Image.URL);
        $(ui.querySelectorAll(".football.full .related-match .result .data img.away")).attr("src", match.Away.Image.URL);

        $(ui.querySelectorAll(".football.full .related-match .agg-result .data .score")).html(match.Home.Score.Agg + " - " + match.Away.Score.Agg);
        $(ui.querySelectorAll(".football.full .related-match .prev-result .data .score")).html(match.RelatedMatch.Home.Score.Match + " - " + match.RelatedMatch.Away.Score.Match);

        $(ui.querySelectorAll(".football.full .related-match .prev-result .data")).attr("href", GetURLFromModel(match.RelatedMatch.URL));

        return ui;
    };

    AddHightlightEvents = function (match) {

        var tmplHighlightEvent = document.querySelector("#tmpl-football-match-highlight-event");

        $(match.Periods).each(function (p, period) {

            $(period.Incidents).each(function (i, inc) {

                var eventID = "highlight-event-" + inc.ID;

                if ($("#" + eventID).length === 0) {

                    

                    var highlightEventObj = undefined;
                    var highlightEventImg = undefined;
                    var highlightEventText = undefined;

                    switch (inc.Type) {
                        case config.Enums.Leagues.Match.Incidents.Types.Football_Goal.ID:
                        case config.Enums.Leagues.Match.Incidents.Types.Football_Penalty.ID:
                        case config.Enums.Leagues.Match.Incidents.Types.Football_OwnGoal.ID:
                            highlightEventObj = tmplHighlightEvent.content.cloneNode(true);

                            var minute = inc.AddMinute > 0 ? inc.Minute + "+" + inc.AddMinute : inc.Minute;

                            if (inc.Type === config.Enums.Leagues.Match.Incidents.Types.Football_OwnGoal.ID)
                                minute = "ע', " + minute;

                            if (inc.Type === config.Enums.Leagues.Match.Incidents.Types.Football_Penalty.ID)
                                minute = "פנדל, " + minute;

                            highlightEventText = `${inc.Player.Name.Main} (${minute})`;
                            highlightEventImg = "https://images.one.co.il/images/msites/2018/01/29/bbaa3848a49b491a58041a1dcfc4e575.png";
                            break;
                        case config.Enums.Leagues.Match.Incidents.Types.Football_RedCard.ID:
                        case config.Enums.Leagues.Match.Incidents.Types.Football_CardUpgradeConfirmed.ID:
                            highlightEventObj = tmplHighlightEvent.content.cloneNode(true);
                            highlightEventText = `${inc.Player.Name.Main} (${inc.Minute})`;
                            highlightEventImg = "https://images.one.co.il/images/msites/2018/01/29/fcc1e7224a73c46aed4baed60ee5da5b.png";
                            break;
                    }

                    if (highlightEventObj !== undefined) {
                        
                        $(highlightEventObj.querySelector(".highlight-event"))
                            .attr("id", eventID)
                            .addClass("the-" + inc.Player.ID);

                        $(highlightEventObj.querySelector("img")).attr("src", highlightEventImg);

                        switch (inc.Belong) {
                            case config.Enums.Leagues.Match.Incidents.Belongs.HomeTeam:
                                $("<span>" + highlightEventText + "</span>").insertAfter($(highlightEventObj.querySelector("img")));
                                $(".teams .home .highlights-events, .teams .home-highlights-events").append(highlightEventObj);
                                break;
                            case config.Enums.Leagues.Match.Incidents.Belongs.AwayTeam:
                                $("<span>" + highlightEventText + "</span>").insertBefore($(highlightEventObj.querySelector("img")));
                                $(".teams .away .highlights-events, .teams .away-highlights-events").append(highlightEventObj);
                                break;
                        }
                    }
                }
                else {
                    //logone("No new highlights events");
                }
            });
        });

        return game;
    };

    window.AddPlayByPlayEvents = function (match) {

        var tmplMatchEvent = document.querySelector("#tmpl-football-match-event");
        var tmplMatchEventGeneral = document.querySelector("#tmpl-football-match-event-general");

        $(match.Periods).each(function (p, period) {

            $(period.Incidents).each(function (i, inc) {

                var mainPlayer = "";
                var mainID = "";
                var relatedPlayer = "";
                var relatedID = "";
                var icon = "";
                var isShowScore = false;
                var eventInfo = "";

                switch (inc.Type) {
                    case config.Enums.Leagues.Match.Incidents.Types.Football_Goal.ID:
                    case config.Enums.Leagues.Match.Incidents.Types.Football_Penalty.ID:
                    case config.Enums.Leagues.Match.Incidents.Types.Football_OwnGoal.ID:
                        mainID = mainPlayer = inc.Player.UID;
                        mainPlayer = inc.Player.Name.Main;
                        icon = "https://images.one.co.il/images/msites/2018/01/29/bbaa3848a49b491a58041a1dcfc4e575.png";

                        if (inc.Assist1 !== null) {
                            relatedID = inc.Assist1.UID;
                            relatedPlayer = "בישול: " + inc.Assist1.Name.Main;
                        }

                        if (inc.Type === config.Enums.Leagues.Match.Incidents.Types.Football_OwnGoal.ID)
                            relatedPlayer = "שער עצמי";

                        if (inc.Type === config.Enums.Leagues.Match.Incidents.Types.Football_Penalty.ID)
                            relatedPlayer = "פנדל";

                        eventInfo = inc.Time + "'" + "<span class=\"score\">" + inc.HomeScore + " - " + inc.AwayScore + "</span>";
                        isShowScore = true;
                        break;

                    case config.Enums.Leagues.Match.Incidents.Types.Football_PenaltyMissed.ID:
                        mainID = mainPlayer = inc.Player.UID;
                        mainPlayer = inc.Player.Name.Main;
                        icon = "https://images.one.co.il/images/msites/2018/01/29/d9dfcbb93bc62d87882c1bd1b5a8b3ab.png";
                        eventInfo = inc.Time + "'";
                        //eventInfo = "<span class=\"score\">" + inc.HomeScore + " - " + inc.AwayScore + "</span>";
                        break;

                    case config.Enums.Leagues.Match.Incidents.Types.Football_RedCard.ID:
                        mainID = mainPlayer = inc.Player.UID;
                        mainPlayer = inc.Player.Name.Main;
                        icon = "https://images.one.co.il/images/msites/2018/01/29/fcc1e7224a73c46aed4baed60ee5da5b.png";
                        eventInfo = inc.Time + "'";
                        break;
                    case config.Enums.Leagues.Match.Incidents.Types.Football_CardUpgradeConfirmed.ID:
                        mainID = mainPlayer = inc.Player.UID;
                        mainPlayer = inc.Player.Name.Main;
                        icon = "https://images.one.co.il/images/msites/2024/11/07/cfc0467a8b8f93179cb4da3b195904c4.svg";
                        eventInfo = inc.Time + "'";
                        break;

                    case config.Enums.Leagues.Match.Incidents.Types.Football_YellowCard.ID:
                        mainID = mainPlayer = inc.Player.UID;
                        mainPlayer = inc.Player.Name.Main;
                        icon = "https://images.one.co.il/images/msites/2017/12/25/yellow_card.svg";
                        eventInfo = inc.Time + "'";
                        break;

                    case config.Enums.Leagues.Match.Incidents.Types.Football_VAR.ID:
                        if (inc.VARResult === 0 ||  inc.VARResult === 2 || inc.VARResult === 4 || inc.VARResult === 6 || inc.VARResult === 8) {
                            mainID = mainPlayer = inc.Player.UID;

                            varResult = FindEnumByID(config.Enums.Leagues.Match.VAR.Result, inc.VARResult)

                            if (varResult !== null)
                                mainPlayer = varResult.Description.Name.Main;

                            relatedPlayer = inc.Player.Name.Main;
                            icon = "https://images.one.co.il/images/msites/2024/03/14/8ad281f838e6815868a2678a0d900b16.svg";
                            eventInfo = inc.Time + "'";

                            if (inc.VARResult === 0) {
                                mainPlayer = inc.Player.Name.Main;
                                relatedPlayer = "";
                            }
                        }
                        break;

                    case config.Enums.Leagues.Match.Incidents.Types.Football_Substitution.ID:
                        if (inc.PlayerIn === null)
                            break;

                        mainID = inc.PlayerIn.UID;
                        mainPlayer = inc.PlayerIn.Name.Main;
                        relatedID = inc.Player.UID;
                        relatedPlayer = inc.Player.Name.Main;
                        icon = "https://images.one.co.il/images/msites/2017/12/25/substitute.svg";
                        eventInfo = inc.Time + "'";
                        break;

                    case config.Enums.Leagues.Match.Incidents.Types.Football_PenaltyShootOut.ID:
                        mainID = mainPlayer = inc.Player.UID;
                        mainPlayer = inc.Player.Name.Main;
                        icon = "https://images.one.co.il/images/msites/2022/12/08/ee801bd37b931c541827b15071d088af.png";
                        eventInfo = "<span class=\"score\">" + inc.HomeScore + " - " + inc.AwayScore + "</span>";
                        break;
                    
                    case config.Enums.Leagues.Match.Incidents.Types.Football_PenaltyShootOutMissed.ID:
                        mainID = mainPlayer = inc.Player.UID;
                        mainPlayer = inc.Player.Name.Main;
                        icon = "https://images.one.co.il/images/msites/2022/12/08/c79aa9fbf0606110163a7652e90bd8e6.png";
                        eventInfo = "<span class=\"score\">" + inc.HomeScore + " - " + inc.AwayScore + "</span>";
                        break;
                }

                var eventID = "event-" + inc.ID;

                if ($("#" + eventID).length === 0) {
                    if (mainPlayer !== "") {

                        var event = tmplMatchEvent.content.cloneNode(true);
                        var eventSelector = undefined;

                        $(event.querySelector("div.event")).attr("id", eventID);

                        switch (inc.Belong) {
                            case config.Enums.Leagues.Match.Incidents.Belongs.HomeTeam.ID:
                                eventSelector = ".home";

                                if (inc.Type === config.Enums.Leagues.Match.Incidents.Types.Football_OwnGoal.ID)
                                    eventSelector = ".away";

                                break;
                            case config.Enums.Leagues.Match.Incidents.Belongs.AwayTeam.ID:
                                eventSelector = ".away";

                                if (inc.Type === config.Enums.Leagues.Match.Incidents.Types.Football_OwnGoal.ID)
                                    eventSelector = ".home";

                                break;
                        }

                        $(event.querySelector(`${eventSelector} div.icon img`)).attr("src", icon);
                        $(event.querySelector(`${eventSelector} div.icon`));//.append("<br />" + inc.Time + "'");

                        $(event.querySelector(`${eventSelector} div.names div.main`)).html(mainPlayer).addClass("player-" + mainID);
                        if (relatedPlayer !== "") {
                            $(event.querySelector(`${eventSelector} div.names div.related`)).html(relatedPlayer).removeClass("hide").addClass("related-" + relatedID);
                        }

                        $(event.querySelector(`.info`))
                            .html(eventInfo);

                        $("#match-events").prepend(event);
                    }

                    if (inc.Belong === 0) {
                        event = tmplMatchEventGeneral.content.cloneNode(true);

                        $("#match-events").prepend(
                            $(event.querySelector(".general-event"))
                                .html(inc.Note)
                                .attr("id", eventID)
                        );
                    }
                }
            }); // end of period incidents

            if (p === 4 && period.Incidents.length > 1 && $(".shootouts").length < 1) {

                var penaltiesBar = GetPenaltiesBar(period);

                $(penaltiesBar.querySelector(`.home .balls .score`)).append($("<img />").attr("src", match.Home.Image.URL).addClass("logo"));
                $(penaltiesBar.querySelector(`.away .balls .score`)).append($("<img />").attr("src", match.Away.Image.URL).addClass("logo"));

                $("#match-events").prepend(penaltiesBar);
            }
        });
    };


    GetPenaltiesBar = function (period) {

        var tmplPenalties = document.querySelector("#tmpl-football-match-shootouts");

        var ui = tmplPenalties.content.cloneNode(true);

        var hscore = 0;
        var ascore = 0;

        $(period.Incidents).each(function (i, inc) {

            var teamtSelector = undefined;

            $(ui.querySelector("div.event")).attr("id", "event-" + inc.ID);

            switch (inc.Belong) {
                case config.Enums.Leagues.Match.Incidents.Belongs.HomeTeam.ID:
                    teamtSelector = ".home";
                    break;
                case config.Enums.Leagues.Match.Incidents.Belongs.AwayTeam.ID:
                    teamtSelector = ".away";
                    break;
            }

            switch (inc.Type) {
                case config.Enums.Leagues.Match.Incidents.Types.Football_PenaltyShootOut.ID:
                    mainID = mainPlayer = inc.Player.ID;
                    mainPlayer = inc.Player.Name.Main;
                    css = "shoot-goal";
                    icon = "https://images.one.co.il/images/msites/2022/12/08/ee801bd37b931c541827b15071d088af.png";
                    eventInfo = "<span class=\"score\">" + inc.HomeScore + " - " + inc.AwayScore + "</span>";
                    hscore = inc.HomeScore;
                    ascore = inc.AwayScore;
                    break;
                case config.Enums.Leagues.Match.Incidents.Types.Football_PenaltyShootOutMissed.ID:
                    mainID = mainPlayer = inc.Player.ID;
                    mainPlayer = inc.Player.Name.Main;
                    css = "shoot-miss";
                    icon = "https://images.one.co.il/images/msites/2022/12/08/c79aa9fbf0606110163a7652e90bd8e6.png";
                    eventInfo = "<span class=\"score\">" + inc.HomeScore + " - " + inc.AwayScore + "</span>";
                    hscore = inc.HomeScore;
                    ascore = inc.AwayScore;
                    break;
            }

            $(ui.querySelector(`${teamtSelector} .balls`)).append($("<span></span>").addClass(css));
            $(ui.querySelector(`${teamtSelector} .names`)).append(
                $("<span></span>")
                    .html(mainPlayer + ", ")
                    .addClass(css)
            );
        });

        var lastPlayer = $(ui.querySelectorAll('.home .names span:last-child')).html();
        $(ui.querySelectorAll('.home .names span:last-child')).html(lastPlayer.replace(",", ""));

        lastPlayer = $(ui.querySelectorAll('.away .names span:last-child')).html();
        $(ui.querySelectorAll('.away .names span:last-child')).html(lastPlayer.replace(",", ""));

        $(ui.querySelector(`.home .balls`)).append($("<div></div>").html(hscore).addClass("score"));
        $(ui.querySelector(`.away .balls`)).append($("<div></div>").html(ascore).addClass("score"));

        if (hscore > ascore)
            $(ui.querySelector(`.home .balls .score`)).addClass("winner");
        if (hscore < ascore)
            $(ui.querySelector(`.away .balls .score`)).addClass("winner");

        return ui;
    };









    // Lineups / Bench / Substituted / Absentee

    window.AddLineupInfo = function (match) {

        $(".match-data-lineups .home .info .team .name").html(match.Home.Name.Main + "<br />" + match.Home.Formation);
        $(".match-data-lineups .home .info .team .logo").attr("src", match.Home.Image.URL);

        $(".match-data-lineups .away .info .team .name").html(match.Away.Name.Main + "<br />" + match.Away.Formation);
        $(".match-data-lineups .away .info .team .logo").attr("src", match.Away.Image.URL);

        if (match.Home.Coach !== null) {
            $(".match-data-lineups .home .info .coach .name").html(match.Home.Coach.Name.Main);
            $(".match-data-lineups .home .info .coach .photo").attr("src", match.Home.Coach.Image.URL);
        }
        else
            $(".match-data-lineups .home .info .coach").addClass("hide");

        if (match.Away.Coach !== null) {
            $(".match-data-lineups .away .info .coach .name").html(match.Away.Coach.Name.Main);
            $(".match-data-lineups .away .info .coach .photo").attr("src", match.Away.Coach.Image.URL);
        }
        else
            $(".match-data-lineups .away .info .coach").addClass("hide");


        if (lineupTeam === match.Home.ID) {
            $(".match-data-lineups .lineup .away").addClass("hide");
            $(".match-data-lineups .lineup .field").css({
                "aspect-ratio": "1125 / 1671",
                "background-size": "cover"
            });
        }

        if (lineupTeam === match.Away.ID) {
            $(".match-data-lineups .lineup .home").addClass("hide");

            $(".match-data-lineups .lineup .field").css({
                "aspect-ratio": "1125 / 1671",
                "background-size": "cover",
                "background-position": "bottom"
            });
        }
    };

    // Field line up
    window.LineupField = function (match) {

        var allIncidents = $.merge([], match.Periods[0].Incidents);
        $.merge(allIncidents, match.Periods[1].Incidents);
        $.merge(allIncidents, match.Periods[2].Incidents);
        $.merge(allIncidents, match.Periods[3].Incidents);

        // when number of incidents for match not changed no need to re-render lineups field
        if (allIncidents.length <= totalNumberOfMatchIncidents)
            return;

        totalNumberOfMatchIncidents = allIncidents.length

        $(".match-data-lineups .field .home, .match-data-lineups .field .away").html("");

        if (lineupTeam === 0 || lineupTeam === match.Home.ID) {
            $(match.Home.FieldPlayers).each(function (i, player) {

                var ui = GetLineupFieldPlayerUI(player, allIncidents);

                $(ui.querySelector(".player")).css({
                    "left": `calc(${player.X}% - calc(var(--lineup-player-container-width) / 2))`,
                    "top": player.Y + "%"
                });

                $(".match-data-lineups .field .home").append(ui);
            });
        }

        if (lineupTeam === 0 || lineupTeam === match.Away.ID) {
            $(match.Away.FieldPlayers).each(function (i, player) {

                var ui = GetLineupFieldPlayerUI(player, allIncidents);

                $(ui.querySelector(".player")).css({
                    "right": `calc(${player.X}% - calc(var(--lineup-player-container-width) / 2))`,
                    "bottom": player.Y + "%"
                });

                $(".match-data-lineups .field .away").append(ui);
            });
        }

    };

    GetLineupFieldPlayerUI = function (player, incidents) {

        var tmpl = document.querySelector("#tmpl-football-match-lineup-field-player");

        var ui = tmpl.content.cloneNode(true);

        if (player.Image.URL.indexOf("photo.one.co.il") > -1)
            $(ui.querySelector(".photo")).css("border", "solid 1px black");

        $(ui.querySelector(".photo")).attr("src", player.Image.URL);
        $(ui.querySelector(".name")).html(player.Name.Short);

        if (player.ID > 0)
            $(ui.querySelector("a.player")).attr("href", GetURLFromModel(player.URL));

        if (player.Shirt !== 0)
            $(ui.querySelector("a.player"))
                .append($("<div></div>")
                    .html("#" + player.Shirt)
                    .addClass("shirt")
            )
                .addClass(player.UID);

        if (!IsNullOrUndefined(player.Rating) && player.Rating !== "0.0" && player.Rating !== "0")
            $(ui.querySelector("a.player"))
                .append($("<div></div>")
                    .html(player.Rating)
                    .addClass("rating")
                )
                .addClass(player.UID);

        if (player.IsCaptain)
            $(ui.querySelector("a.player"))
                .append($("<img />")
                    .attr("src", "https://images.one.co.il/images/msites/2023/12/27/captain.png")
                    .addClass("icon captain")
                );

        $(incidents).each(function (i, inc) {
            if (inc.Belong !== 0 && player.UID === inc.Player.UID) {
                switch (inc.Type) {
                    case config.Enums.Leagues.Match.Incidents.Types.Football_Substitution.ID:
                        $(ui.querySelector("a.player"))
                            .append($("<img />")
                                .attr("src", "https://images.one.co.il/images/msites/2023/12/27/sub.png")
                                .addClass("icon substitution")
                            );
                        break;
                    case config.Enums.Leagues.Match.Incidents.Types.Football_RedCard.ID:
                    case config.Enums.Leagues.Match.Incidents.Types.Football_CardUpgradeConfirmed.ID:
                        $(ui.querySelector("a.player"))
                            .append($("<img />")
                                .attr("src", "https://images.one.co.il/images/msites/2018/01/29/fcc1e7224a73c46aed4baed60ee5da5b.png")
                                .addClass("icon red")
                            );
                        break;
                    case config.Enums.Leagues.Match.Incidents.Types.Football_YellowCard.ID:
                        $(ui.querySelector("a.player"))
                            .append($("<img />")
                                .attr("src", "https://images.one.co.il/images/msites/2023/12/27/yellow.png")
                                .addClass("icon yellow")
                            );
                        break;
                    case config.Enums.Leagues.Match.Incidents.Types.Football_Goal.ID:
                    case config.Enums.Leagues.Match.Incidents.Types.Football_Penalty.ID:
                    case config.Enums.Leagues.Match.Incidents.Types.Football_OwnGoal.ID:
                        $(ui.querySelector("a.player"))
                            .append($("<img />")
                                .attr("src", "https://images.one.co.il/images/msites/2023/12/27/goal1.png")
                                .addClass("icon goal")
                            );
                        break;
                }
            }
        });

        return ui;
    };


    // Substitued lineup
    LineupSubstituted = function (match) {

        var allIncidents = $.merge([], match.Periods[0].Incidents);
        $.merge(allIncidents, match.Periods[1].Incidents);
        $.merge(allIncidents, match.Periods[2].Incidents);
        $.merge(allIncidents, match.Periods[3].Incidents);

        $(".match-data-lineups .substituted .home, .match-data-lineups .substituted .away").html("");

        $(match.Home.SubstitutePlayers).each(function (i, player) {

            var ui = GetLineupSubstitutedPlayerUI(player, allIncidents);

            $(".match-data-lineups .substituted .home").append(ui);
        });

        $(match.Away.SubstitutePlayers).each(function (i, player) {

            var ui = GetLineupSubstitutedPlayerUI(player, allIncidents);

            $(".match-data-lineups .substituted .away").append(ui);
        });
    };

    GetLineupSubstitutedPlayerUI = function (player, incidents) {
        var tmpl = document.querySelector("#tmpl-football-match-lineup-out-of-field-player");

        var ui = tmpl.content.cloneNode(true);

        $(ui.querySelector(".shirt")).html("#" + player.Shirt);
        $(ui.querySelector(".photo")).attr("src", player.Image.URL);
        $(ui.querySelector(".name")).html(player.Name.Main).addClass(player.UID);

        $(incidents).each(function (i, inc) {
            switch (inc.Type) {
                case config.Enums.Leagues.Match.Incidents.Types.Football_Substitution.ID:
                    if (inc.PlayerIn !== null && inc.PlayerIn.UID === player.UID) {
                        $(ui.querySelector(".name"))
                            .append("<br />")
                            .append($("<img />").attr("src", "https://images.one.co.il/images/msites/2023/12/27/sub.png"))
                            .append($("<span></spam>").html(inc.Player.Name.Main + " (" + inc.Time + ")").addClass(inc.Player.UID))
                            ;
                    }
                    break;
                case config.Enums.Leagues.Match.Incidents.Types.Football_Goal.ID:
                case config.Enums.Leagues.Match.Incidents.Types.Football_Penalty.ID:
                case config.Enums.Leagues.Match.Incidents.Types.Football_OwnGoal.ID:
                    if (inc.Player.UID === player.UID) {
                        $(ui.querySelector(".cards"))
                            .append($("<img />")
                                .attr("src", "https://images.one.co.il/images/msites/2023/12/27/goal1.png")
                                .css(
                                    {
                                        "width": "1.5rem"
                                    })
                            );
                    }
                    break;
            }
        });

        return ui;
    };


    // Bench lineup
    LineupBench = function (match) {
        $(".match-data-lineups .bench .home, .match-data-lineups .bench .away").html("");

        $(match.Home.BenchPlayers).each(function (i, player) {

            var ui = GetLineupSubstituedPlayerUI(player);

            $(".match-data-lineups .bench .home").append(ui);
        });

        $(match.Away.BenchPlayers).each(function (i, player) {

            var ui = GetLineupSubstituedPlayerUI(player);

            $(".match-data-lineups .bench .away").append(ui);
        });
    };

    GetLineupSubstituedPlayerUI = function (player) {
        var tmpl = document.querySelector("#tmpl-football-match-lineup-out-of-field-player");

        var ui = tmpl.content.cloneNode(true);

        $(ui.querySelector(".shirt")).html("#" + player.Shirt);
        $(ui.querySelector(".photo")).attr("src", player.Image.URL);
        $(ui.querySelector(".name")).html(player.Name.Main);

        return ui;
    };

    // Injured lineup
    LineupAbsentee = function (match) {
        $(".match-data-lineups .absentee .home, .match-data-lineups .absentee .away").html("");

        $(match.Home.AbsenteePlayers).each(function (i, player) {

            var ui = GetLineupAbsentreePlayerUI(player);

            $(".match-data-lineups .absentee .home").append(ui);
        });

        $(match.Away.AbsenteePlayers).each(function (i, player) {

            var ui = GetLineupAbsentreePlayerUI(player);

            $(".match-data-lineups .absentee .away").append(ui);
        });
    };

    GetLineupAbsentreePlayerUI = function (player) {
        var tmpl = document.querySelector("#tmpl-football-match-lineup-out-of-field-player");

        var ui = tmpl.content.cloneNode(true);

        $(ui.querySelector(".shirt")).html("");
        $(ui.querySelector(".photo")).attr("src", player.Image.URL);
        $(ui.querySelector(".name")).html(player.Name.Main + "<br />")
            .append(
                $("<img />").attr("src", player.Absentee.Type === 1 ?
                    "https://images.one.co.il/images/msites/2023/12/27/injury.png" : "").css("width", "1.5rem")
            );



        return ui;
    };


















})(jQuery);
(function ($) {

    window.BasketballRealTimeUpdateMatchFull = function (match) {

        if (!IsNullOrUndefined(match.Timer) && !match.Timer.IsTimeRun)
            $("div.state").html(match.TextStates.State + (match.IsLive ? "<br />" + match.TextStates.MinutesLive : ""));

        if (match.IsStarted) {
            $(".basketball.full .header .state-score .score").html(match.Home.Score.Match + " - " + match.Away.Score.Match);

            if (match.Home.Score.HalfTime > -1 && match.Away.Score.HalfTime > -1)
                $(".football.full .header .state-score .half-time").html(`(מחצית ${match.Home.Score.HalfTime} - ${match.Away.Score.HalfTime})`);
        }

        var tmpl = document.querySelector('#tmpl-basket-quarters-results');

        let ui = tmpl.content.cloneNode(true);

        if (!IsNullOrUndefined(match.Home.Image) && !IsNullOrUndefined(match.Home.Image.URL)) {
            $(ui.querySelector(".teams .home .logo")).append(
                $("<img />").attr("src", match.Home.Image.URL)
            );

            $(ui.querySelector(".teams .home .name")).html(match.Home.Name.Main);

            $(ui.querySelector(".teams .away .logo")).append(
                $("<img />").attr("src", match.Away.Image.URL)
            );

            $(ui.querySelector(".teams .away .name")).html(match.Away.Name.Main);
        }
        else {
            $(ui.querySelector(".teams .home .name")).html($("#match-header .teams .home .name").html());
            $(ui.querySelector(".teams .away .name")).html($("#match-header .teams .away .name").html());

            $(ui.querySelector(".teams .home .logo")).append(
                $("<img />").attr("src", $("#match-header .teams .home .logo img").attr("src"))
            );

            $(ui.querySelector(".teams .away .logo")).append(
                $("<img />").attr("src", $("#match-header .teams .away .logo img").attr("src"))
            );
            
        }

        if (match.Home.Score.Match > -1) {
            $(ui.querySelector(".teams .home .score")).html(match.Home.Score.Match);
            $(ui.querySelector(".teams .away .score")).html(match.Away.Score.Match);
        }

        var periods = [];

        // DataProvider 0 doesnt support scores of quarters
        if (match.DataProvider !== 0) {

            if (match.Home.Score.Section1 > -1) {
                periods.push({
                    "Home": match.Home.Score.Section1,
                    "Away": match.Away.Score.Section1,
                    "Name": "1"
                });
            }

            if (match.Home.Score.Section2 > -1) {
                periods.push({
                    "Home": match.Home.Score.Section2,
                    "Away": match.Away.Score.Section2,
                    "Name": "2"
                });
            }

            if (match.Home.Score.Section3 > -1) {
                periods.push({
                    "Home": match.Home.Score.Section3,
                    "Away": match.Away.Score.Section3,
                    "Name": "3"
                });
            }

            if (match.Home.Score.Section4 > -1) {
                periods.push({
                    "Home": match.Home.Score.Section4,
                    "Away": match.Away.Score.Section4,
                    "Name": "4"
                });
            }

            $(match.Home.Score.Quarters).each(function (q, quarter) {
                periods.push({
                    "Home": match.Home.Score.Quarters[q],
                    "Away": match.Away.Score.Quarters[q],
                    "Name": "הא'" + (q > 0 ? (q + 1) : "")
                });
            });

            $(periods).each(function (p, period) {

                //if (!period.IsFinished || !period.IsConfirmed)
                //    return;

                var width = `calc(100% / ${periods.length} - 1rem)`;

                $(ui.querySelector(".teams .header .quarters .results")).append(
                    $("<span></span>")
                        .css({
                            "width": width,
                            "max-width": "19%"
                        })
                        .addClass("period-result")
                        .html(period.Name)
                );

                $(ui.querySelector(".teams .home .quarters .results")).append(
                    $("<span></span>")
                        .css({
                            "width": width,
                            "max-width": "19%"
                        })
                        .addClass("period-result")
                        .html(period.Home)
                );

                $(ui.querySelector(".teams .away .quarters .results")).append(
                    $("<span></span>")
                        .css({
                            "width": width,
                            "max-width": "19%"
                        })
                        .addClass("period-result")
                        .html(period.Away)
                );

            });
        }

        if (match.State === config.Enums.Leagues.Match.States.Ended) {
            if (match.Home.Score.Match > match.Away.Score.Match)
                $(ui.querySelector(".teams .home")).addClass("winner");
            else
                $(ui.querySelector(".teams .away")).addClass("winner");
        }

        $("#match-events").html(ui);

        /*
        if ($("#quarters-results").length < 1)
            $("#match-events").append(ui);
        else
            $("#match-events").replaceWith(ui);
        */
    };

}) (jQuery);
(function ($) {

    window.TennisRealTimeUpdateMatchFull = function (match) {

        if (!IsNullOrUndefined(match.Timer) && !match.Timer.IsTimeRun)
            $("div.state").html(match.TextStates.State + (match.IsLive ? "<br />" + match.TextStates.MinutesLive : ""));

        var tmpl = document.querySelector('#tmpl-tennis-sets-results');

        let ui = tmpl.content.cloneNode(true);

        $(ui.querySelector(".teams .home .name")).html($(".header .home .name").html());
        $(ui.querySelector(".teams .home .logo")).html($(".header .home .tennis-portraits").html());

        $(ui.querySelector(".teams .away .name")).html($(".header .away .name").html());
        $(ui.querySelector(".teams .away .logo")).html($(".header .away .tennis-portraits").html());

        /*
        var $homePartraits = TennisGetPortraits(match.Home.Squad);
        if ($homePartraits !== null)
            $(ui.querySelector(".teams .home .logo")).append($homePartraits);



        var $awayPartraits = TennisGetPortraits(match.Away.Squad);
        if ($awayPartraits !== null)
            

        
        */
        if (match.Home.Score.Match > -1) {
            $(ui.querySelector(".teams .home .score")).html(match.Home.Score.Match);
            $(ui.querySelector(".teams .away .score")).html(match.Away.Score.Match);
        }

        $(ui.querySelector(".teams .home .game, .teams .away .game, .teams .home .serve, .teams .away .serve")).html("");

        const serve = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA0AAAANCAYAAABy6+R8AAABYElEQVQoU41SLUhDURQ+330iIkMmRrFsBqMYTAoTi7C9ucHAFWFBRRctMgwGDQaDNoNhYNCVoXuCtg0xi3HiT9BgMvnCBL3H897bHtt8ghcuXL6/ew7ngNrO6EUyyZrXBJpi4hAINoGvlerZfIif3bWkcB6xaq7v1X4vMvNCe4j/Bl4MZcwP94frtZliwzVFrcQJM2UDDU0QCnui+Xo2rQLGq6mwbX9npJxB4VeFiASZvVKxDVAd8ktZhGkB3hTThgYvE9N0kFEpLLGmDKIV88Np2hNBC5Fl1kcSNPDLCOwKlkKkkuBOEvfS6LEE7XSbFGFfg2a7fvJkQq4LuULMYx1GpfKkecsxXUrqXAcJaigyFpl0QcYw4RYOqjFwBU0xOAPVWp93lyKiT8EO5N6C0cvgSWbkped0c07m6Z+DbUsDUHoyrez/NsItD6WR0FDO34hWWODuEd3AoMPHuOW38ANDrpeeRBclmQAAAABJRU5ErkJggg==";

        if (match.Serve === 1)
            $(ui.querySelector(".teams .home .serve")).append(
                $("<img />")
                    .attr("src", serve)
            );

        if (match.Serve === 2)
            $(ui.querySelector(".teams .away .serve")).append(
                $("<img />")
                    .attr("src", serve)
            );

        if (match.Home.Score.Game > 0 || match.Away.Score.Game > 0) {
            if (match.Home.Score.Game > -1)
                $(ui.querySelector(".teams .home .game")).html(match.Home.Score.Game);

            if (match.Away.Score.Game > -1)
                $(ui.querySelector(".teams .away .game")).html(match.Away.Score.Game);
        }

        $(match.Home.Score.Set).each(function (s, score) {

            var width = `20%`;

            $(ui.querySelector(".teams .header .sets .results")).append(
                $("<span></span>")
                    .css("width", width)
                    .addClass("set-result")
                    .html("מע'<br />" + (s + 1))
            );

            $(ui.querySelector(".teams .home .sets .results")).append(
                $("<span></span>")
                    .css("width", width)
                    .addClass("set-result set-result-" + s)
                    .html(match.Home.Score.Set[s].Set)
            );

            if (match.Home.Score.Set[s].TieBreak > 0) {
                $(ui.querySelector(".teams .home .sets .results .set-result-" + s)).append(
                    $("<sup></sup>")
                        .css("width", width)
                        .addClass("tie-result")
                        .html(match.Home.Score.Set[s].TieBreak)
                );
            }

            $(ui.querySelector(".teams .away .sets .results")).append(
                $("<span></span>")
                    .css("width", width)
                    .addClass("set-result set-result-" + s)
                    .html(match.Away.Score.Set[s].Set)
            );

            if (match.Away.Score.Set[s].TieBreak > 0) {
                $(ui.querySelector(".teams .away .sets .results .set-result-" + s)).append(
                    $("<sup></sup>")
                        .css("width", width)
                        .addClass("tie-result")
                        .html(match.Away.Score.Set[s].TieBreak)
                );
            }

        });


        if (match.State === config.Enums.Leagues.Match.States.Ended) {
            if (match.Home.Score.Match > match.Away.Score.Match)
                $(ui.querySelector(".teams .home")).addClass("winner");
            else
                $(ui.querySelector(".teams .away")).addClass("winner");
        }

        $("#match-events").html(ui);
    };


    window.TennisGetPortraits = function (squad, numberOfParticipants) {

        var $div = $("<div />")
            .addClass("tennis-portraits");

        if (IsNullOrUndefined(squad)) {

            for (var i = 0; i < numberOfParticipants; i++)
                $div.append($("<img />").addClass("logo").attr("src", spacerUrl));

            return $div;
        }

        


        $(squad).each(function (i, player) {

            if (errorLogos.indexOf(player.ID.toString()) < 0)
                $div.append($("<img />")
                    .addClass("logo")
                    //.css({ "margin-left": "-3rem", "margin-right": "-3rem"})
                    .attr("src", player.Image.PC)
                    .attr("onerror", "javascript:NoLogo('tennis_" + player.ID + "');$j(this).attr('src',spacerUrl);")
                );
        });

        return $div;
    };

})(jQuery);
(function ($) {

    window.Timer = function () {

        for (const match of MATCHES_STATE.values()) {

            if (match.SportType !== config.Enums.Leagues.Sport.Types.Basketball.ID || IsNullOrUndefined(match.Timer))
                continue;

            if (match.Timer.IsTimeRun) {

                match.TextStates.MinutesLive = CalculateMatchMinute(match.Timer);

                if (match.TextStates.MinutesLive !== "00:00") {
                    if (!IS_SINGLE_MATCH_MODE) {
                        $("#match-" + match.ID + " a div.state")
                            .html(match.TextStates.State + (match.IsLive ? "<br />" + match.TextStates.MinutesLive : ""));
                    }
                    else
                        $("div.state").html(match.TextStates.State + (match.IsLive ? "<br />" + match.TextStates.MinutesLive : ""));
                }
            }
        }
    };

    window.CalculateMatchMinute = function (timer) {

        var secs = timer.IsCountdown ?
            timer.Seconds - (Math.floor(Date.now() / 1000 - timer.UpdateTime)) :
            timer.Seconds + (Math.floor(Date.now() / 1000 - timer.UpdateTime));

        if (secs < 0)
            secs = 0;

        return FormatTime(secs);
    };

    window.FormatTime = function (seconds, isAddHours = false) {

        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const remainingSeconds = Math.floor(seconds % 60);

        let hoursText = isAddHours ? `${String(hours).padStart(2, '0')}:` : "";

        return `${hoursText}${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
    };

})(jQuery);

(function ($) {
///
/// Compares current and prev status of match
//
    window.IsMatchStatusChanged = function (mCurrent, mPrev) {

        if (mCurrent.State !== mPrev.State)
            return true;

        switch (mCurrent.SportType) {
            // Football
            case 0:
                if (mCurrent.Timer.Minute + mCurrent.Timer.AddMinute !== mPrev.Timer.Minute + mPrev.Timer.AddMinute)
                    return true;

                if (mCurrent.Home.Score.RegularTime + mCurrent.Home.Score.Penalty !== mPrev.Home.Score.RegularTime + mPrev.Home.Score.Penalty ||
                    mCurrent.Away.Score.RegularTime + mCurrent.Away.Score.Penalty !== mPrev.Away.Score.RegularTime + mPrev.Away.Score.Penalty)
                    return true;
                break;
            // Basketball
            case 1:
                if (mCurrent.Minute !== mPrev.Minute)
                    return true;

                if (mCurrent.Home.Score.RegularTime !== mPrev.Home.Score.RegularTime ||
                    mCurrent.Away.Score.RegularTime !== mPrev.Away.Score.RegularTime)
                    return true;

                if (mCurrent.Timer !== null) {
                    if (mCurrent.Timer.UpdateTime !== mPrev.Timer.UpdateTime ||
                        mCurrent.Timer.Seconds !== mPrev.Timer.Seconds ||
                        mCurrent.Timer.IsTimeRun !== mPrev.Timer.IsTimeRun)
                        return true;
                }
                break;

            // Tennis
            case 2:

                if (mCurrent.Home.Score.Match !== mPrev.Home.Score.Match ||
                    mCurrent.Away.Score.Match !== mPrev.Away.Score.Match)
                    return true;

                /*
                if (mCurrent.Serve !== mPrev.Serve)
                    return true;

                var isChanged = false;

                $(mCurrent.Home.Score.Set).each(function (s, score) {
                    if (mCurrent.Home.Score.Set[s].Set !== mPrev.Home.Score.Set[s].Set ||
                        mCurrent.Home.Score.Set[s].Tie !== mPrev.Home.Score.Set[s].Tie ||
                        mCurrent.Away.Score.Set[s].Set !== mPrev.Away.Score.Set[s].Set ||
                        mCurrent.Away.Score.Set[s].Tie !== mPrev.Away.Score.Set[s].Tie)
                        isChanged = true;
                    return;
                });

                return isChanged;
                */
                break;
        }

        return false;
    };

    window.ToggleFullMatch = function (id) {

        $j(id).toggle();

        var index = openedMatches.indexOf(id);

        if (index < 0)
            openedMatches.push(id);
        else
            openedMatches.splice(index, 1);
    };

    window.NoLogo = function (id) {
        if (errorLogos.indexOf(id.toString()) < 0) {
            errorLogos.push(id.toString());

            SetCookieDays("no-team-logo", JSON.stringify(errorLogos), 1);
        }
    };

    window.GetStadium = function (match) {

        if (match.Stadium === null)
            return "";

        var ret = "";

        if (match.Stadium.Country !== null) {
            ret += "<img src='" + match.Stadium.Country.Image.URL + "' alt='" + match.Stadium.Country.Name.Main + "' title='" + match.Stadium.Country.Name.Main + "' class='country-flag' /> ";
        }

        ret += !IsNullOrUndefined(match.Stadium.City) ? match.Stadium.City.Main + ", " : ""; 
        ret += !IsNullOrUndefined(match.Stadium.Name.Main) ? match.Stadium.Name.Main + " " : "";

        if (match.Stadium.Capacity > 0)
            ret += "(מכיל " + match.Stadium.Capacity.toLocaleString('he-IL') + ")";

        return ret;
    };

    window.GetWeather = function (match) {

        if (match.Weather === null)
            return "";

        var ret = "<div class='w100p center ltr weather'>";

        var weatherIconURL = weatherTitle = "";

        switch (match.SportType) {
            case config.Enums.Leagues.Sport.Types.Soccer.ID:

                const condition = FindEnumByID(config.Enums.General.Weather, match.Weather.Condition);

                if (condition !== null) {
                    weatherIconURL = condition.Description.Image.PC;
                    weatherTitle = condition.Description.Name.Main;
                }

                ret += "<div class='weagther-pressure'>";
                ret += "<img src='https://images.one.co.il/images/msites/2025/01/15/ecb3d550457970e7902098493d50f6ad.png' class='weather-icon pressure' /> ";
                ret += match.Weather.Pressure + " ";
                ret += "</div>";

                ret += "<div class='weagther-temperature'>";
                ret += "<img src='https://images.one.co.il/images/msites/2025/01/15/bf268661a03bdb22ccd9dcc5af8ce691.png' class='weather-icon temperature' /> ";
                ret += match.Weather.Temperature + " ";
                ret += "</div>";

                ret += "<div class='weagther-wind'>";
                ret += "<img src='https://images.one.co.il/images/msites/2025/01/15/fdb0aa5aa841aeb943825b0b05c363b0.png' class='weather-icon wind' /> ";
                ret += match.Weather.Wind + " ";
                ret += "</div>";

                ret += "<div class='weagther-humidity'>";
                ret += "<img src='https://images.one.co.il/images/msites/2025/01/15/37df2dce51c12aff004ba9f7a70164f6.png' class='weather-icon humidity' /> ";
                ret += match.Weather.Humidity + " ";
                ret += "</div>";

                if (!IsNullOrEmpty(weatherIconURL)) {
                    ret += "<div class='weagther-condition'>";
                    ret += `<img src="${weatherIconURL}" alt='${weatherTitle}' title='${weatherTitle}' class='weather-icon condition' /> `;
                    ret += "</div>";
                }
                break;
        }

        ret += "</div>";
        
        return ret;
    };

})(jQuery);


