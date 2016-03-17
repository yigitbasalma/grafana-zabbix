import angular from 'angular';
import _ from 'lodash';
import './zabbixAPICore.service';

/** @ngInject */
function ZabbixAPIService($q, alertSrv, zabbixAPICoreService) {

  /**
   * Zabbix API Wrapper.
   * Creates Zabbix API instance with given parameters (url, credentials and other).
   * Wraps API calls and provides high-level methods.
   */
  class ZabbixAPI {

    constructor(api_url, username, password, basicAuth, withCredentials) {
      this.url              = api_url;
      this.username         = username;
      this.password         = password;
      this.auth             = "";

      this.requestOptions = {
        basicAuth: basicAuth,
        withCredentials: withCredentials
      };

      this.loginPromise = null;

      this.$q = $q;
      this.alertSrv = alertSrv;
      this.zabbixAPICore = zabbixAPICoreService;

      this.getTrend = this.getTrend_ZBXNEXT1193;
      //getTrend = getTrend_30;
    }

    //////////////////////////
    // Core method wrappers //
    //////////////////////////

    request(method, params) {
      var self = this;

      return this.zabbixAPICore.request(this.url, method, params, this.requestOptions, this.auth)
        .then(function(result) {
          return result;
        },
        // Handle API errors
        function(error) {
          if (isNotAuthorized(error.data)) {
            return self.loginOnce().then(
              function() {
                return self.request(method, params);
              },
              // Handle user.login method errors
              function(error) {
                self.alertAPIError(error.data);
              });
          }
        });
    }

    alertAPIError(message) {
      this.alertSrv.set(
        "Zabbix API Error",
        message,
        'error'
      );
    }

    /**
     * When API unauthenticated or auth token expired each request produce login()
     * call. But auth token is common to all requests. This function wraps login() method
     * and call it once. If login() already called just wait for it (return its promise).
     * @return login promise
     */
    loginOnce() {
      var self = this;
      var deferred  = this.$q.defer();
      if (!self.loginPromise) {
        self.loginPromise = deferred.promise;
        self.login().then(
          function(auth) {
            self.loginPromise = null;
            self.auth = auth;
            deferred.resolve(auth);
          },
          function(error) {
            self.loginPromise = null;
            deferred.reject(error);
          }
        );
      } else {
        return self.loginPromise;
      }
      return deferred.promise;
    }

    /**
     * Get authentication token.
     */
    login() {
      return this.zabbixAPICore.login(this.url, this.username, this.password, this.requestOptions);
    }

    /**
     * Get Zabbix API version
     */
    getVersion() {
      return this.zabbixAPICore.getVersion(this.url, this.requestOptions);
    }

    ////////////////////////////////
    // Zabbix API method wrappers //
    ////////////////////////////////

    getGroups() {
      var params = {
        output: ['name'],
        sortfield: 'name',
        selectHosts: []
      };

      return this.request('hostgroup.get', params);
    }

    getHosts() {
      var params = {
        output: ['name', 'host'],
        sortfield: 'name',
        selectGroups: [],
        selectApplications: ['applicationid']
      };

      return this.request('host.get', params);
    }

    getApplications() {
      var params = {
        output: ['name'],
        sortfield: 'name',

        // Hack for supporting different apis (2.2 vs 2.4 vs 3.0)
        selectHost: [],
        selectHosts: [],
        selectItems: ['itemid']
      };

      return this.request('application.get', params);
    }

    getItems() {
      var params = {
        output: [
          'name', 'key_',
          'value_type',
          'hostid',
          'status',
          'state'
        ],
        sortfield: 'name',
        selectApplications: []
      };

      return this.request('item.get', params);
    }

    /**
     * Get Hosts list with host's items.
     * @return {[type]} [description]
     */
    getHostsExtend() {
      var params = {
        output: ['name', 'host'],
        sortfield: 'name',
        selectGroups: ['groupid'],
        selectApplications: ['applicationid'],
        selectItems: [
          'itemid',
          'name',
          'key_',
          'value_type',
          'hostid',
          'status',
          'state'
        ]
      };

      return this.request('host.get', params);
    }

    getLastValue(itemid) {
      var params = {
        output: ['lastvalue'],
        itemids: itemid
      };
      return this.request('item.get', params).then(function(items) {
        if (items.length) {
          return items[0].lastvalue;
        } else {
          return null;
        }
      });
    }

    /**
     * Perform history query from Zabbix API
     *
     * @param  {Array}  items       Array of Zabbix item objects
     * @param  {Number} time_from   Time in seconds
     * @param  {Number} time_till   Time in seconds
     * @return {Array}  Array of Zabbix history objects
     */
    getHistory(items, time_from, time_till) {
      var self = this;

      // Group items by value type
      var grouped_items = _.groupBy(items, 'value_type');

      // Perform request for each value type
      return this.$q.all(_.map(grouped_items, function (items, value_type) {
        var itemids = _.map(items, 'itemid');
        var params = {
          output: 'extend',
          history: value_type,
          itemids: itemids,
          sortfield: 'clock',
          sortorder: 'ASC',
          time_from: time_from
        };

        // Relative queries (e.g. last hour) don't include an end time
        if (time_till) {
          params.time_till = time_till;
        }

        return self.request('history.get', params);
      })).then(_.flatten);
    }

    /**
     * Perform trends query from Zabbix API
     * Use trends api extension from ZBXNEXT-1193 patch.
     *
     * @param  {Array}  items       Array of Zabbix item objects
     * @param  {Number} time_from   Time in seconds
     * @param  {Number} time_till   Time in seconds
     * @return {Array}  Array of Zabbix trend objects
     */
    getTrend_ZBXNEXT1193(items, time_from, time_till) {
      var self = this;

      // Group items by value type
      var grouped_items = _.groupBy(items, 'value_type');

      // Perform request for each value type
      return this.$q.all(_.map(grouped_items, function (items, value_type) {
        var itemids = _.map(items, 'itemid');
        var params = {
          output: 'extend',
          trend: value_type,
          itemids: itemids,
          sortfield: 'clock',
          sortorder: 'ASC',
          time_from: time_from
        };

        // Relative queries (e.g. last hour) don't include an end time
        if (time_till) {
          params.time_till = time_till;
        }

        return self.request('trend.get', params);
      })).then(_.flatten);
    }

    getTrend_30(items, time_from, time_till, value_type) {
      var self = this;
      var itemids = _.map(items, 'itemid');

      var params = {
        output: ["itemid",
          "clock",
          value_type
        ],
        itemids: itemids,
        time_from: time_from
      };

      // Relative queries (e.g. last hour) don't include an end time
      if (time_till) {
        params.time_till = time_till;
      }

      return self.request('trend.get', params);
    }

    getITService(/* optional */ serviceids) {
      var params = {
        output: 'extend',
        serviceids: serviceids
      };
      return this.request('service.get', params);
    }

    getSLA(serviceids, from, to) {
      var params = {
        serviceids: serviceids,
        intervals: [{
          from: from,
          to: to
        }]
      };
      return this.request('service.getsla', params);
    }

    getTriggers(groupids, hostids, applicationids, showEvents) {
      var params = {
        output: 'extend',
        groupids: groupids,
        hostids: hostids,
        applicationids: applicationids,
        expandDescription: true,
        expandData: true,
        monitored: true,
        skipDependent: true,
        //only_true: true,
        filter: {
          value: 1
        },
        selectGroups: ['name'],
        selectHosts: ['name'],
        selectItems: ['name', 'key_', 'lastvalue'],
        selectLastEvent: 'extend'
      };

      if (showEvents) {
        params.filter.value = showEvents;
      }

      return this.request('trigger.get', params);
    }

    getAcknowledges(eventids) {
      var params = {
        output: 'extend',
        eventids: eventids,
        preservekeys: true,
        select_acknowledges: 'extend',
        sortfield: 'clock',
        sortorder: 'DESC'
      };

      return this.request('event.get', params)
        .then(function (events) {
          return _.filter(events, function(event) {
            return event.acknowledges.length;
          });
        });
    }

  }

  return ZabbixAPI;
}

function isNotAuthorized(message) {
  return (
    message === "Session terminated, re-login, please." ||
    message === "Not authorised." ||
    message === "Not authorized."
  );
}

angular
  .module('grafana.services')
  .factory('zabbixAPIService', ZabbixAPIService);
